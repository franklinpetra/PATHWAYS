import type { Sql, TransactionSql } from "postgres";
import type { LicensurePacket, PacketCredential, PacketFee } from "./packet";

/**
 * Applies a licensure packet in one transaction. Nothing is overwritten silently:
 *
 *  - Same effective date, same content: a re-verification; only the as-of date moves forward.
 *  - Same effective date, different content: refused. Correct the stored version deliberately.
 *  - Later effective date: the open version is closed the day the new one starts, keeping history.
 *  - Earlier than a stored version: refused (out-of-order history).
 *  - An authority's role or a credential's kind that differs from what's stored: refused.
 *
 * With dryRun, the same statements run and are rolled back, so the report shows exactly
 * what would change.
 */

class DryRunRollback extends Error {}

type Tx = TransactionSql<Record<string, never>>;

interface StoredFee {
  fee_type: string;
  label: string | null;
  amount_status: string;
  amount: string | null;
  currency: string | null;
  recurrence_months: number | null;
  notes: string | null;
}

function feeKey(f: {
  type: string;
  label: string | null;
  status: string;
  amount: number | null;
  currency: string | null;
  recurrence_months: number | null;
  notes: string | null;
}): string {
  return [
    f.type,
    f.label ?? "",
    f.status,
    f.amount == null ? "" : Number(f.amount).toFixed(2),
    f.currency ?? "",
    f.recurrence_months ?? "",
    f.notes ?? "",
  ].join("|");
}

const fromPacket = (f: PacketFee) =>
  feeKey({
    type: f.type,
    label: f.label ?? null,
    status: f.status,
    amount: f.amount ?? null,
    currency: f.currency ?? null,
    recurrence_months: f.recurrence_months ?? null,
    notes: f.notes ?? null,
  });

const fromStored = (f: StoredFee) =>
  feeKey({
    type: f.fee_type,
    label: f.label,
    status: f.amount_status,
    amount: f.amount == null ? null : Number(f.amount),
    currency: f.currency?.trim() ?? null,
    recurrence_months: f.recurrence_months,
    notes: f.notes,
  });

export async function loadPacket(sql: Sql, packet: LicensurePacket, opts: { dryRun: boolean }): Promise<string[]> {
  const actions: string[] = [];
  try {
    await sql.begin(async (tx) => {
      await apply(tx as unknown as Tx, packet, actions);
      if (opts.dryRun) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }
  return actions;
}

async function apply(tx: Tx, packet: LicensurePacket, actions: string[]) {
  const [jurisdiction] = await tx<{ id: string }[]>`select id from jurisdictions where code = ${packet.jurisdiction}`;
  if (!jurisdiction) throw new Error(`Jurisdiction ${packet.jurisdiction} does not exist`);

  const authorityIds = new Map<string, string>();
  for (const a of packet.authorities) {
    const [existing] = await tx<{ id: string; role: string; website_url: string | null }[]>`
      select id, role, website_url from issuing_authorities where name = ${a.name}`;
    if (existing) {
      if (existing.role !== a.role) {
        throw new Error(`${a.name} is stored as '${existing.role}', packet says '${a.role}'; resolve deliberately`);
      }
      if (a.website_url && a.website_url !== existing.website_url) {
        await tx`update issuing_authorities set website_url = ${a.website_url} where id = ${existing.id}`;
        actions.push(`update website for ${a.name}`);
      }
      authorityIds.set(a.name, existing.id);
    } else {
      const [row] = await tx<{ id: string }[]>`
        insert into issuing_authorities (name, role, jurisdiction_id, website_url)
        values (${a.name}, ${a.role}, ${jurisdiction.id}, ${a.website_url ?? null})
        returning id`;
      authorityIds.set(a.name, row.id);
      actions.push(`create authority ${a.name} (${a.role})`);
    }
  }

  for (const credential of packet.credentials) {
    await applyCredential(tx, packet, credential, jurisdiction.id, authorityIds, actions);
  }
}

async function applyCredential(
  tx: Tx,
  packet: LicensurePacket,
  c: PacketCredential,
  jurisdictionId: string,
  authorityIds: Map<string, string>,
  actions: string[],
) {
  const found = await tx<{ onet_soc_code: string }[]>`
    select onet_soc_code from occupations where onet_soc_code = any(${c.occupations})`;
  const missing = c.occupations.filter((code) => !found.some((f) => f.onet_soc_code === code));
  if (missing.length) throw new Error(`${c.name}: occupations not loaded: ${missing.join(", ")} (load O*NET first)`);

  let [credential] = await tx<{ id: string; kind: string }[]>`
    select c.id, c.kind from credentials c
    join credential_jurisdictions cj on cj.credential_id = c.id
    where c.name = ${c.name} and cj.jurisdiction_id = ${jurisdictionId}`;
  if (credential && credential.kind !== c.kind) {
    throw new Error(`${c.name} is stored as a ${credential.kind}, packet says ${c.kind}; resolve deliberately`);
  }
  if (!credential) {
    [credential] = await tx<{ id: string; kind: string }[]>`
      insert into credentials (name, kind) values (${c.name}, ${c.kind}) returning id, kind`;
    await tx`insert into credential_jurisdictions (credential_id, jurisdiction_id) values (${credential.id}, ${jurisdictionId})`;
    actions.push(`create credential ${c.name} (${c.kind}) in ${packet.jurisdiction}`);
  }

  for (const code of c.occupations) {
    const added = await tx`
      insert into credential_occupations (credential_id, onet_soc_code) values (${credential.id}, ${code})
      on conflict do nothing returning onet_soc_code`;
    if (added.length) actions.push(`${c.name}: link occupation ${code}`);
  }
  const issued = await tx`
    insert into credential_authorities (credential_id, authority_id, relationship)
    values (${credential.id}, ${authorityIds.get(c.issuer)!}, 'issuer')
    on conflict do nothing returning authority_id`;
  if (issued.length) actions.push(`${c.name}: issuer ${c.issuer}`);

  const sourceAuthorityId = authorityIds.get(packet.source.authority)!;
  const versions = await tx<{ id: string; effective_from: string; effective_to: string | null }[]>`
    select id, effective_from::text, effective_to::text from credential_versions
    where credential_id = ${credential.id} and source_authority_id = ${sourceAuthorityId}
    order by effective_from`;
  const s = packet.source;

  const later = versions.find((v) => v.effective_from > s.effective_from);
  if (later) throw new Error(`${c.name}: a version effective ${later.effective_from} is already stored; out-of-order load refused`);

  const same = versions.find((v) => v.effective_from === s.effective_from);
  if (same) {
    const [stored] = await tx<
      { requirements: string | null; duration_note: string | null; source_name: string; source_url: string; observation_period: string | null }[]
    >`select requirements, duration_note, source_name, source_url, observation_period from credential_versions where id = ${same.id}`;
    const storedFees = await tx<StoredFee[]>`
      select fee_type, label, amount_status, amount::text, currency, recurrence_months, notes
      from credential_fees where credential_version_id = ${same.id}`;
    const identical =
      stored.requirements === (c.requirements ?? null) &&
      stored.duration_note === (c.duration_note ?? null) &&
      stored.source_name === s.name &&
      stored.source_url === s.url &&
      stored.observation_period === (s.observation_period ?? null) &&
      [...storedFees.map(fromStored)].sort().join("\n") === [...c.fees.map(fromPacket)].sort().join("\n");
    if (!identical) {
      throw new Error(`${c.name}: differs from the stored version effective ${s.effective_from}; correct it deliberately`);
    }
    const bumped = await tx`
      update credential_versions set source_as_of = ${s.retrieved_on}
      where id = ${same.id} and source_as_of < ${s.retrieved_on} returning id`;
    await tx`
      update credential_fees set source_as_of = ${s.retrieved_on}
      where credential_version_id = ${same.id} and source_as_of < ${s.retrieved_on}`;
    actions.push(
      bumped.length
        ? `${c.name}: unchanged; re-verified as of ${s.retrieved_on}`
        : `${c.name}: unchanged; already verified as of ${s.retrieved_on} or later`,
    );
    return;
  }

  const open = versions.find((v) => v.effective_to === null);
  if (open) {
    await tx`update credential_versions set effective_to = ${s.effective_from} where id = ${open.id}`;
    actions.push(`${c.name}: close version effective ${open.effective_from} on ${s.effective_from}`);
  }

  const [version] = await tx<{ id: string }[]>`
    insert into credential_versions (
      credential_id, effective_from, requirements, duration_note,
      source_name, source_url, observation_period, source_as_of, source_authority_id
    ) values (
      ${credential.id}, ${s.effective_from}, ${c.requirements ?? null}, ${c.duration_note ?? null},
      ${s.name}, ${s.url}, ${s.observation_period ?? null}, ${s.retrieved_on}, ${sourceAuthorityId}
    ) returning id`;
  for (const f of c.fees) {
    await tx`
      insert into credential_fees (
        credential_version_id, fee_type, label, amount_status, amount, currency, recurrence_months, notes,
        source_name, source_url, observation_period, source_as_of, source_authority_id
      ) values (
        ${version.id}, ${f.type}, ${f.label ?? null}, ${f.status}, ${f.amount ?? null}, ${f.currency ?? null},
        ${f.recurrence_months ?? null}, ${f.notes ?? null},
        ${s.name}, ${s.url}, ${s.observation_period ?? null}, ${s.retrieved_on}, ${sourceAuthorityId}
      )`;
  }
  actions.push(`${c.name}: add version effective ${s.effective_from} with ${c.fees.length} fee${c.fees.length === 1 ? "" : "s"}`);
}
