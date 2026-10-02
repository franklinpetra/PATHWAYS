import { describe, expect, it } from "vitest";
import { findUnsupportedFigures, isSupportedClaim, supportedClaims } from "@/lib/agents/grounding";

const today = "2026-10-02";
const source = {
  name: "Example Board fee schedule",
  observationPeriod: null,
  asOf: "2026-09-01",
  verificationAuthority: "Example State Board",
  url: "https://example.test/fees",
};
const claim = (statement: string, overrides: Partial<typeof source> = {}) => ({ statement, source: { ...source, ...overrides } });

describe("isSupportedClaim fails closed", () => {
  it("accepts complete, dated provenance", () => {
    expect(isSupportedClaim(claim("Exam fee: USD 175.00"), today)).toBe(true);
  });

  it.each([
    ["no URL", { url: "" }],
    ["non-http URL", { url: "ftp://example.test" }],
    ["no source name", { name: " " }],
    ["no authority", { verificationAuthority: "" }],
    ["no date", { asOf: "" }],
    ["malformed date", { asOf: "Sept 2026" }],
    ["future date", { asOf: "2026-12-01" }],
  ])("rejects a claim with %s", (_label, overrides) => {
    expect(isSupportedClaim(claim("Exam fee: USD 175.00", overrides), today)).toBe(false);
  });

  it("rejects an empty statement", () => {
    expect(isSupportedClaim(claim("  "), today)).toBe(false);
  });

  it("drops unsupported claims and counts them", () => {
    const result = supportedClaims([claim("ok"), claim("bad", { url: "" })], today);
    expect(result.claims.map((c) => c.statement)).toEqual(["ok"]);
    expect(result.dropped).toBe(1);
  });
});

describe("findUnsupportedFigures", () => {
  const claims = [claim("Exam fee: USD 175.00. Completion rate: 58% (2023-24 cohort)."), claim("Estimated cost: $3,100 (tuition).")];

  it("passes figures that appear in verified claims, in any money format", () => {
    expect(findUnsupportedFigures("The exam is $175 [1], the program about $3,100 [2], 58% finish [1].", claims)).toEqual([]);
  });

  it("flags money and percentages the sources don't contain", () => {
    expect(findUnsupportedFigures("The background check is $45 and 90% of people pass.", claims)).toEqual(["$45", "90%"]);
  });

  it("allows figures the person supplied themselves", () => {
    expect(findUnsupportedFigures("At $18.50 an hour that's a raise.", claims, ["I make $18.50 an hour now"])).toEqual([]);
  });

  it("reports each unverified figure once", () => {
    expect(findUnsupportedFigures("$45 now, $45 later.", claims)).toEqual(["$45"]);
  });
});
