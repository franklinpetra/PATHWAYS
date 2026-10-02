import { describe, expect, it } from "vitest";
import { formatAttribution, traceClaims, type TraceableClaim } from "@/lib/workspace/attribution";

const source = (name: string, observationPeriod: string | null = null) => ({
  name,
  observationPeriod,
  asOf: "2026-09-15",
  verificationAuthority: "Example Authority",
  url: "https://example.test",
});

const claims: TraceableClaim[] = [
  { kind: "occupation", statement: "O*NET-SOC 29-1141.00: Registered Nurses.", source: source("O*NET OnLine") },
  {
    kind: "program",
    statement: "Example Program, offered by Example College.",
    source: source("Career Bridge", "2023-24 cohort"),
    place: { name: "Example College", address: "100 Example St, Tacoma, WA", latitude: 47.2, longitude: -122.4 },
  },
  { kind: "apprenticeship", statement: "Example apprenticeship.", source: source("ARTS") },
];

describe("formatAttribution", () => {
  it("renders [Source Name | Observation Period / As-of Date | Verification Authority]", () => {
    expect(formatAttribution(source("Career Bridge", "2023-24 cohort"))).toBe(
      "[Career Bridge | 2023-24 cohort / as of Sep 15, 2026 | Example Authority]",
    );
    expect(formatAttribution(source("O*NET OnLine"))).toBe("[O*NET OnLine | As of Sep 15, 2026 | Example Authority]");
  });
});

describe("traceClaims", () => {
  it("returns cited claims in order, once each, with their places", () => {
    const { citations, places } = traceClaims("A [2] and [1], again [2].", claims);
    expect(citations.map((c) => c.index)).toEqual([1, 2]);
    expect(citations[1]).toMatchObject({ kind: "program", source: { name: "Career Bridge" } });
    expect(places).toEqual([expect.objectContaining({ label: "Example College", source: claims[1].source })]);
  });

  it("ignores citation numbers that don't match a real source", () => {
    expect(traceClaims("Made up [0] [4] [12].", claims).citations).toEqual([]);
  });
});
