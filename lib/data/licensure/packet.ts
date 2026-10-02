import { z } from "zod";
import { AMOUNT_STATUSES, CREDENTIAL_KINDS, FEE_TYPES } from "@/lib/db/types";

/**
 * Licensure source packets: one reviewed JSON file per official document
 * (e.g. data/licensure/wa/wac-246-945-990.json).
 *
 * Every known or zero fee must be backed by an excerpt copied from the official text:
 * the excerpt must appear in the fetched source, and the fee's row label and amount must
 * appear together in the excerpt. A packet loads only after a named person reviews it.
 */

const isoDate = z.iso.date();
const socCode = z.string().regex(/^\d{2}-\d{4}\.\d{2}$/, "O*NET-SOC code like 29-2052.00");

const feeSchema = z
  .object({
    type: z.enum(FEE_TYPES),
    /** Display label; defaults to the fee type's label. */
    label: z.string().min(1).nullish(),
    /** The fee's row title exactly as the source prints it, e.g. "Initial credential". */
    source_label: z.string().min(1).nullish(),
    status: z.enum(AMOUNT_STATUSES),
    amount: z.number().nullish(),
    currency: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code like USD").nullish(),
    recurrence_months: z.number().int().positive().nullish(),
    notes: z.string().min(1).nullish(),
  })
  .superRefine((fee, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (fee.status === "known" && !(typeof fee.amount === "number" && fee.amount > 0 && fee.currency)) {
      issue("a known fee needs an amount above 0 and a currency");
    }
    if (fee.status === "zero" && !(fee.amount === 0 && fee.currency)) issue("a zero fee needs amount 0 and a currency");
    if (["unknown", "variable", "not_applicable"].includes(fee.status) && fee.amount != null) {
      issue(`a ${fee.status} fee must not have an amount`);
    }
    if ((fee.status === "known" || fee.status === "zero") && !fee.source_label) {
      issue("a known or zero fee needs source_label, the row title as printed in the source");
    }
    if (fee.type === "other" && !fee.label) issue('an "other" fee needs a label');
    if (typeof fee.amount === "number" && Math.round(fee.amount * 100) !== fee.amount * 100) {
      issue("amount has more than two decimal places");
    }
  });

const credentialSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(CREDENTIAL_KINDS),
  occupations: z.array(socCode).min(1),
  /** Name of the governing authority that issues the credential (must be listed in authorities). */
  issuer: z.string().min(1),
  requirements: z.string().min(1).nullish(),
  duration_note: z.string().min(1).nullish(),
  /** Passages copied from the source. Each must appear in the fetched text. */
  excerpts: z.array(z.string().min(1)).min(1),
  fees: z.array(feeSchema),
});

export const packetSchema = z
  .object({
    status: z.enum(["draft", "reviewed"]),
    source: z.object({
      name: z.string().min(1),
      url: z.url({ protocol: /^https?$/ }),
      /** Date the text was retrieved and checked. */
      retrieved_on: isoDate,
      /** Authority that sets what the source says (becomes the version's verification authority). */
      authority: z.string().min(1),
      /** Date this text took effect, and the citation it comes from. */
      effective_from: isoDate,
      effective_basis: z.string().min(1),
      observation_period: z.string().min(1).nullish(),
    }),
    review: z.object({
      reviewed_by: z.string().min(1).nullable(),
      reviewed_on: isoDate.nullable(),
      notes: z.array(z.string()).default([]),
    }),
    jurisdiction: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/),
    authorities: z
      .array(
        z.object({
          name: z.string().min(1),
          role: z.enum(["governing", "discovery"]),
          website_url: z.url({ protocol: /^https?$/ }).nullish(),
        }),
      )
      .min(1),
    credentials: z.array(credentialSchema).min(1),
  })
  .superRefine((p, ctx) => {
    const names = new Set(p.authorities.map((a) => a.name));
    const governing = new Set(p.authorities.filter((a) => a.role === "governing").map((a) => a.name));
    if (!governing.has(p.source.authority)) {
      ctx.addIssue({ code: "custom", path: ["source", "authority"], message: "must be a governing authority listed in authorities" });
    }
    p.credentials.forEach((c, i) => {
      if (!names.has(c.issuer) || !governing.has(c.issuer)) {
        ctx.addIssue({ code: "custom", path: ["credentials", i, "issuer"], message: "must be a governing authority listed in authorities" });
      }
      const keys = c.fees.map((f) => `${f.type}|${f.label ?? ""}`);
      if (new Set(keys).size !== keys.length) {
        ctx.addIssue({ code: "custom", path: ["credentials", i, "fees"], message: "duplicate fee type and label" });
      }
    });
    if (p.source.retrieved_on < p.source.effective_from) {
      ctx.addIssue({ code: "custom", path: ["source", "retrieved_on"], message: "retrieved before the text took effect" });
    }
  });

export type LicensurePacket = z.infer<typeof packetSchema>;
export type PacketCredential = LicensurePacket["credentials"][number];
export type PacketFee = PacketCredential["fees"][number];

export function parsePacket(json: unknown): { packet: LicensurePacket } | { errors: string[] } {
  const result = packetSchema.safeParse(json);
  if (result.success) return { packet: result.data };
  return { errors: result.error.issues.map((i) => `${i.path.join(".") || "(packet)"}: ${i.message}`) };
}

/** A reviewed packet names who reviewed it and when. Drafts can only be dry-run. */
export function reviewProblems(packet: LicensurePacket, today: string): string[] {
  const problems: string[] = [];
  if (packet.status !== "reviewed") problems.push('status is "draft"; set it to "reviewed" after checking every figure');
  if (!packet.review.reviewed_by) problems.push("review.reviewed_by is empty");
  if (!packet.review.reviewed_on) problems.push("review.reviewed_on is empty");
  else if (packet.review.reviewed_on > today) problems.push("review.reviewed_on is in the future");
  if (packet.source.retrieved_on > today) problems.push("source.retrieved_on is in the future");
  return problems;
}

// ---------------------------------------------------------------------------
// Excerpt verification against the official text
// ---------------------------------------------------------------------------

/** Lowercase letters, digits, and decimal points only: survives table markup, "$", and spacing. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "");
}

/** Visible text of an HTML page. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

/** Problems that keep a packet's figures from being traced to the source text. */
export function excerptProblems(packet: LicensurePacket, sourceText: string): string[] {
  const source = normalizeForMatch(sourceText);
  const problems: string[] = [];
  for (const c of packet.credentials) {
    c.excerpts.forEach((excerpt, i) => {
      if (!source.includes(normalizeForMatch(excerpt))) problems.push(`${c.name}: excerpt ${i + 1} is not in the source text`);
    });
    const excerptText = c.excerpts.map(normalizeForMatch).join("|");
    for (const fee of c.fees) {
      if (fee.status !== "known" && fee.status !== "zero") continue;
      const row = normalizeForMatch(`${fee.source_label} ${fee.amount!.toFixed(2)}`);
      if (!excerptText.includes(row)) {
        problems.push(`${c.name}: "${fee.source_label}" with ${fee.amount!.toFixed(2)} is not in its excerpts`);
      }
    }
  }
  return problems;
}
