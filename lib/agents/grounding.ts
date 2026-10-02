import type { SourceAttribution } from "@/lib/workspace/events";

/**
 * Grounding checks that fail closed.
 *
 * Before the prompt: a claim reaches the model only with complete provenance (source name,
 * http(s) URL, verification authority) and a valid as-of date no later than today.
 *
 * After the reply: money amounts and percentages are compared with the verified claims
 * the model was given and with what the person said. Anything else is reported as
 * unverified, stored with the message, and shown to the person.
 */

export interface GroundedClaim {
  statement: string;
  source: SourceAttribution;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isSupportedClaim(claim: GroundedClaim, today: string): boolean {
  const s = claim.source;
  return (
    Boolean(claim.statement?.trim()) &&
    Boolean(s?.name?.trim()) &&
    Boolean(s?.verificationAuthority?.trim()) &&
    /^https?:\/\/\S+$/.test(s?.url ?? "") &&
    ISO_DATE.test(s?.asOf ?? "") &&
    !Number.isNaN(Date.parse(s.asOf)) &&
    s.asOf <= today
  );
}

export function supportedClaims<T extends GroundedClaim>(claims: T[], today: string): { claims: T[]; dropped: number } {
  const kept = claims.filter((c) => isSupportedClaim(c, today));
  return { claims: kept, dropped: claims.length - kept.length };
}

const FIGURE =
  /(?:US\$|\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\$\s?\d+(?:\.\d+)?|\bUSD\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|dollars)\b|\b\d{1,3}(?:\.\d+)?\s?(?:%|percent\b)/gi;

function figureKey(raw: string): string {
  const isPercent = /%|percent/i.test(raw);
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return `${isPercent ? "pct" : "usd"}:${Math.round(n * 100) / 100}`;
}

export function extractFigures(text: string): { raw: string; key: string }[] {
  return [...text.matchAll(FIGURE)].map((m) => ({ raw: m[0].trim(), key: figureKey(m[0]) }));
}

/** Money and percentage figures in the reply that no verified claim or person-supplied text contains. */
export function findUnsupportedFigures(reply: string, claims: GroundedClaim[], personText: string[] = []): string[] {
  const allowed = new Set(
    [...claims.map((c) => c.statement), ...personText].flatMap((t) => extractFigures(t).map((f) => f.key)),
  );
  const unsupported: string[] = [];
  const seen = new Set<string>();
  for (const f of extractFigures(reply)) {
    if (allowed.has(f.key) || seen.has(f.key)) continue;
    seen.add(f.key);
    unsupported.push(f.raw);
  }
  return unsupported;
}
