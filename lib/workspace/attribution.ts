import type { Citation, SourceAttribution, VerifiedPlace } from "./events";

/** The parts of a Fact-Finder claim needed to attribute it. */
export interface TraceableClaim {
  kind: Citation["kind"];
  statement: string;
  source: SourceAttribution;
  place?: { name: string; address: string; latitude: number | null; longitude: number | null };
}

/** Formats an ISO date as "Sep 15, 2026", in UTC so it never shifts a day. */
export function formatSourceDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

/** The period/date part of an attribution: "2023-24 cohort / as of Sep 15, 2026" or "As of Sep 15, 2026". */
export function attributionWhen(source: SourceAttribution): string {
  const asOf = formatSourceDate(source.asOf);
  return source.observationPeriod ? `${source.observationPeriod} / as of ${asOf}` : `As of ${asOf}`;
}

/** [Source Name | Observation Period / As-of Date | Verification Authority] */
export function formatAttribution(source: SourceAttribution): string {
  return `[${source.name} | ${attributionWhen(source)} | ${source.verificationAuthority}]`;
}

/**
 * Traces each [n] the reply cites back to the sourced claim it refers to. Numbers
 * that don't match a claim are ignored: only real sources are ever attributed.
 */
export function traceClaims(reply: string, claims: TraceableClaim[]): { citations: Citation[]; places: VerifiedPlace[] } {
  const cited = [...new Set([...reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
    .filter((n) => n >= 1 && n <= claims.length)
    .sort((a, b) => a - b);
  const citations = cited.map((index) => {
    const claim = claims[index - 1];
    return { index, kind: claim.kind, statement: claim.statement, source: claim.source };
  });
  const places = cited.flatMap((index) => {
    const claim = claims[index - 1];
    return claim.place
      ? [
          {
            label: claim.place.name,
            address: claim.place.address,
            latitude: claim.place.latitude,
            longitude: claim.place.longitude,
            source: claim.source,
          },
        ]
      : [];
  });
  return { citations, places };
}
