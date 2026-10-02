import type { CredentialFeeRecord, CredentialMatch, FeeType, SourcedRecord } from "@/lib/db/types";
import type { SourceAttribution } from "@/lib/workspace/events";

/**
 * Turns licensure records into claims, failing closed at every step:
 *
 *  - Only versions in effect today, from a governing authority (e.g. a state board), can
 *    state requirements or fees. Discovery sources (e.g. CareerOneStop) only yield a
 *    pointer to the governing authority, with no figures.
 *  - A fee is stated only as its record says: a known amount with its currency, zero,
 *    unknown, variable, or not applicable. A malformed fee is dropped, never guessed.
 *  - A total out-of-pocket cost is stated only when every one-time fee is known or zero
 *    in a single currency. Otherwise the claim says what keeps the total unconfirmed.
 */

export interface LicensureClaim {
  id: string;
  kind: "licensure";
  statement: string;
  source: SourceAttribution;
}

export interface LicensureFindings {
  claims: LicensureClaim[];
  notes: string[];
}

const FEE_LABEL: Record<FeeType, string> = {
  application: "Application fee",
  exam: "Exam fee",
  background_check: "Background check",
  fingerprinting: "Fingerprinting",
  initial_license: "Initial license fee",
  renewal: "Renewal fee",
  late_renewal: "Late renewal fee",
  credential_evaluation: "Credential evaluation",
  other: "Other fee",
};

/**
 * Fees on the path to obtaining the credential. Renewals, penalties, and other fees
 * (reissuance, verification, duplicates) are listed but never added to the total.
 */
const TO_OBTAIN: readonly FeeType[] = [
  "application",
  "exam",
  "background_check",
  "fingerprinting",
  "initial_license",
  "credential_evaluation",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function attribution(record: SourcedRecord): SourceAttribution {
  return {
    name: record.source_name,
    observationPeriod: record.observation_period,
    asOf: record.source_as_of,
    verificationAuthority: record.source_authority.name,
    url: record.source_url,
  };
}

/** Provenance must be complete and dated no later than today. */
export function hasProvenance(record: SourcedRecord, today: string): boolean {
  return (
    Boolean(record.source_name?.trim()) &&
    /^https?:\/\//.test(record.source_url ?? "") &&
    ISO_DATE.test(record.source_as_of ?? "") &&
    record.source_as_of <= today &&
    Boolean(record.source_authority?.name?.trim())
  );
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" })
      .format(amount)
      .replace(/\u00a0/g, " ");
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function feeLabel(fee: CredentialFeeRecord): string {
  return fee.label?.trim() || FEE_LABEL[fee.fee_type];
}

/** One fee as its record states it, or null if the record is malformed. */
export function describeFee(fee: CredentialFeeRecord): string | null {
  const label = feeLabel(fee);
  const every = fee.recurrence_months ? ` every ${fee.recurrence_months} months` : "";
  const validCurrency = typeof fee.currency === "string" && /^[A-Z]{3}$/.test(fee.currency);
  switch (fee.amount_status) {
    case "known":
      if (!validCurrency || fee.amount == null || !(Number(fee.amount) > 0)) return null;
      return `${label}: ${money(Number(fee.amount), fee.currency!)}${every}`;
    case "zero":
      if (!validCurrency || Number(fee.amount) !== 0) return null;
      return `${label}: no charge (${money(0, fee.currency!)})`;
    case "unknown":
      return fee.amount == null ? `${label}: amount not published in this source` : null;
    case "variable":
      return fee.amount == null ? `${label}: varies${fee.notes ? ` (${fee.notes})` : ""}` : null;
    case "not_applicable":
      return fee.amount == null ? `${label}: not applicable` : null;
    default:
      return null;
  }
}

/** Total cost to obtain the credential, or the reason it can't be confirmed. */
export function oneTimeTotal(fees: CredentialFeeRecord[]): { total: string } | { unconfirmed: string } {
  const oneTime = fees.filter((f) => TO_OBTAIN.includes(f.fee_type) && f.amount_status !== "not_applicable");
  if (oneTime.length === 0) return { unconfirmed: "no fees to obtain the credential are listed" };
  const open = oneTime.filter((f) => f.amount_status !== "known" && f.amount_status !== "zero");
  if (open.length) return { unconfirmed: `${open.map(feeLabel).join(", ")} ${open.length === 1 ? "is" : "are"} not confirmed` };
  if (oneTime.some((f) => describeFee(f) === null)) return { unconfirmed: "a fee record is incomplete" };
  const currencies = new Set(oneTime.map((f) => f.currency));
  if (currencies.size !== 1) return { unconfirmed: "fees are listed in different currencies" };
  const sum = oneTime.reduce((s, f) => s + Number(f.amount), 0);
  return { total: money(Math.round(sum * 100) / 100, [...currencies][0]!) };
}

function inEffect(m: CredentialMatch, today: string): boolean {
  return m.version.effective_from <= today && (m.version.effective_to === null || m.version.effective_to > today);
}

function issuerNames(m: CredentialMatch): string {
  const issuers = m.authorities.filter((a) => a.relationship === "issuer" && a.role === "governing").map((a) => a.name);
  return issuers.length ? issuers.join(" / ") : "the state licensing board";
}

export function licensureClaims(matches: CredentialMatch[], today: string): LicensureFindings {
  const claims: LicensureClaim[] = [];
  const notes: string[] = [];
  const byCredential = new Map<string, CredentialMatch[]>();
  for (const m of matches) byCredential.set(m.credential_id, [...(byCredential.get(m.credential_id) ?? []), m]);

  for (const [credentialId, versions] of byCredential) {
    const usable = versions.filter((v) => inEffect(v, today) && hasProvenance(v.version, today));
    if (usable.length < versions.length) notes.push(`Some ${versions[0].credential_name} records were skipped: out of date range or missing provenance.`);

    const governing = usable.find((v) => v.version.source_authority.role === "governing");
    const discovery = usable.find((v) => v.version.source_authority.role === "discovery");
    const where = `in ${(governing ?? discovery ?? versions[0]).jurisdiction_name}`;

    if (!governing) {
      if (discovery) {
        claims.push({
          id: `licensure:${credentialId}:listing`,
          kind: "licensure",
          statement: `${discovery.version.source_name} lists the ${discovery.credential_name} (${discovery.credential_kind}) ${where} for this occupation. Requirements and fees are not confirmed until checked with ${issuerNames(discovery)}.`,
          source: attribution(discovery.version),
        });
      }
      continue;
    }

    const v = governing.version;
    const identity = `${governing.credential_name} (${governing.credential_kind}) ${where}, issued by ${issuerNames(governing)}.`;
    if (v.requirements || v.duration_note) {
      claims.push({
        id: `licensure:${credentialId}:requirements`,
        kind: "licensure",
        statement: [
          identity,
          v.requirements ? `Requirements: ${v.requirements.replace(/\.$/, "")}.` : null,
          v.duration_note ? `Time to obtain: ${v.duration_note.replace(/\.$/, "")}.` : null,
          `Requirements in effect since ${v.effective_from}.`,
        ]
          .filter(Boolean)
          .join(" "),
        source: attribution(v),
      });
    }

    // Fees: only governing, dated, well-formed records; grouped by the source that states them.
    const fees = governing.fees.filter((f) => {
      if (f.source_authority?.role !== "governing") {
        notes.push(`A ${feeLabel(f).toLowerCase()} for ${governing.credential_name} came only from a discovery source and was not used.`);
        return false;
      }
      if (!hasProvenance(f, today) || describeFee(f) === null) {
        notes.push(`A ${feeLabel(f).toLowerCase()} record for ${governing.credential_name} was incomplete and was not used.`);
        return false;
      }
      return true;
    });
    if (fees.length === 0) {
      notes.push(`No verified fee schedule for ${governing.credential_name}; fees are unconfirmed.`);
      if (!v.requirements && !v.duration_note) {
        claims.push({ id: `licensure:${credentialId}:identity`, kind: "licensure", statement: identity, source: attribution(v) });
      }
      continue;
    }

    const groups = new Map<string, CredentialFeeRecord[]>();
    for (const f of fees) {
      const key = `${f.source_url}|${f.source_as_of}|${f.source_authority.name}`;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    // A total is attributed to its source, so it is only stated when one source lists every fee.
    const total: ReturnType<typeof oneTimeTotal> =
      groups.size === 1 ? oneTimeTotal(fees) : { unconfirmed: "fees come from more than one source" };
    for (const group of groups.values()) {
      const lines = group.map(describeFee).join("; ");
      const totalText =
        groups.size === 1
          ? "total" in total
            ? ` Known fees to obtain the credential total ${total.total}.`
            : ` Total cost to obtain can't be confirmed: ${total.unconfirmed}.`
          : "";
      claims.push({
        id: `licensure:${credentialId}:fees:${group[0].source_url}`,
        kind: "licensure",
        statement: `${identity} Fees in effect since ${v.effective_from}: ${lines}.${totalText}`,
        source: attribution(group[0]),
      });
    }
    if (groups.size > 1) notes.push(`${governing.credential_name} fees come from more than one source, so no total is stated.`);
  }

  return { claims, notes };
}
