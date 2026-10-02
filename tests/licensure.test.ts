import { describe, expect, it } from "vitest";
import { describeFee, licensureClaims, oneTimeTotal } from "@/lib/data/licensure/claims";
import type { AuthorityRole, CredentialFeeRecord, CredentialMatch } from "@/lib/db/types";

// Fictional records that exercise the rules; they are not real fees.
const today = "2026-10-02";
type Authority = { name: string; role: AuthorityRole };
const board: Authority = { name: "Example State Board", role: "governing" };
const discoveryLayer: Authority = { name: "Example Discovery Directory", role: "discovery" };
const sourced = (authority: Authority = board) => ({
  source_name: `${authority.name} records`,
  source_url: "https://example.test/source",
  observation_period: null,
  source_as_of: "2026-09-01",
  source_authority: authority,
});

const fee = (overrides: Partial<CredentialFeeRecord>): CredentialFeeRecord => ({
  ...sourced(),
  fee_type: "exam",
  label: null,
  amount_status: "known",
  amount: 100,
  currency: "USD",
  recurrence_months: null,
  notes: null,
  ...overrides,
});

const match = (overrides: Partial<CredentialMatch> = {}, versionOverrides: Partial<CredentialMatch["version"]> = {}): CredentialMatch => ({
  credential_id: "c1",
  credential_name: "Example Technician License",
  credential_kind: "license",
  jurisdiction_code: "US-WA",
  jurisdiction_name: "Washington",
  version: {
    ...sourced(),
    id: "v1",
    effective_from: "2026-01-01",
    effective_to: null,
    requirements: "Example requirement",
    duration_note: null,
    ...versionOverrides,
  },
  fees: [],
  authorities: [{ name: board.name, role: "governing", relationship: "issuer", website_url: null }],
  ...overrides,
});

describe("describeFee distinguishes amount states", () => {
  it.each([
    [{ amount_status: "known", amount: 175, currency: "USD" }, "Exam fee: USD 175.00"],
    [{ amount_status: "zero", amount: 0, currency: "USD" }, "Exam fee: no charge (USD 0.00)"],
    [{ amount_status: "unknown", amount: null, currency: null }, "Exam fee: amount not published in this source"],
    [{ amount_status: "variable", amount: null, currency: null, notes: "set by vendor" }, "Exam fee: varies (set by vendor)"],
    [{ amount_status: "not_applicable", amount: null, currency: null }, "Exam fee: not applicable"],
    [{ fee_type: "renewal", amount_status: "known", amount: 50, currency: "USD", recurrence_months: 24 }, "Renewal fee: USD 50.00 every 24 months"],
  ] as const)("%o", (overrides, expected) => {
    expect(describeFee(fee(overrides as Partial<CredentialFeeRecord>))).toBe(expected);
  });

  it.each([
    ["known without currency", { amount_status: "known", amount: 175, currency: null }],
    ["known with zero amount", { amount_status: "known", amount: 0, currency: "USD" }],
    ["zero without currency", { amount_status: "zero", amount: 0, currency: null }],
    ["unknown with an amount", { amount_status: "unknown", amount: 175, currency: "USD" }],
    ["malformed currency", { amount_status: "known", amount: 175, currency: "usd" }],
  ] as const)("fails closed on %s", (_label, overrides) => {
    expect(describeFee(fee(overrides as Partial<CredentialFeeRecord>))).toBeNull();
  });
});

describe("oneTimeTotal", () => {
  it("totals one-time fees when all are known or zero, excluding renewals", () => {
    const fees = [
      fee({ fee_type: "application", amount: 85 }),
      fee({ fee_type: "exam", amount: 175 }),
      fee({ fee_type: "background_check", amount_status: "zero", amount: 0 }),
      fee({ fee_type: "renewal", amount: 50, recurrence_months: 24 }),
    ];
    expect(oneTimeTotal(fees)).toEqual({ total: "USD 260.00" });
  });

  it("refuses a total when any one-time fee is unknown or variable", () => {
    const fees = [fee({ amount: 175 }), fee({ fee_type: "background_check", amount_status: "unknown", amount: null, currency: null })];
    expect(oneTimeTotal(fees)).toEqual({ unconfirmed: "Background check is not confirmed" });
  });

  it("leaves reissuance and other non-obtaining fees out of the total", () => {
    const fees = [
      fee({ fee_type: "initial_license", amount: 140 }),
      fee({ fee_type: "other", label: "Expired credential reissuance", amount: 70 }),
      fee({ fee_type: "late_renewal", amount: 70 }),
    ];
    expect(oneTimeTotal(fees)).toEqual({ total: "USD 140.00" });
  });

  it("refuses a total across currencies", () => {
    expect(oneTimeTotal([fee({ amount: 100 }), fee({ fee_type: "application", amount: 50, currency: "CAD" })])).toEqual({
      unconfirmed: "fees are listed in different currencies",
    });
  });
});

describe("licensureClaims fails closed", () => {
  it("states requirements and fees from a governing source, with a total", () => {
    const { claims } = licensureClaims([match({ fees: [fee({ amount: 175 }), fee({ fee_type: "application", amount: 85 })] })], today);
    expect(claims.map((c) => c.statement)).toEqual([
      "Example Technician License (license) in Washington, issued by Example State Board. Requirements: Example requirement. Requirements in effect since 2026-01-01.",
      "Example Technician License (license) in Washington, issued by Example State Board. Fees in effect since 2026-01-01: Exam fee: USD 175.00; Application fee: USD 85.00. Known fees to obtain the credential total USD 260.00.",
    ]);
    expect(claims[0].source).toMatchObject({ verificationAuthority: "Example State Board", asOf: "2026-09-01" });
  });

  it("never states figures from a discovery source; it only points to the governing board", () => {
    const listing = match(
      { fees: [fee({ ...sourced(discoveryLayer), amount: 999 })] },
      { ...sourced(discoveryLayer) },
    );
    const { claims } = licensureClaims([listing], today);
    expect(claims).toHaveLength(1);
    expect(claims[0].statement).toContain("not confirmed until checked with Example State Board");
    expect(claims[0].statement).not.toMatch(/999|USD/);
  });

  it("prefers the governing version when both exist, ignoring discovery fees", () => {
    const governing = match({ fees: [fee({ amount: 175 })] });
    const discovery = match({ fees: [fee({ ...sourced(discoveryLayer), amount: 999 })] }, { ...sourced(discoveryLayer), id: "v2" });
    const statements = licensureClaims([governing, discovery], today).claims.map((c) => c.statement).join(" ");
    expect(statements).toContain("USD 175.00");
    expect(statements).not.toContain("999");
  });

  it("drops fees a discovery source supplied inside a governing version", () => {
    const { claims, notes } = licensureClaims([match({ fees: [fee({ ...sourced(discoveryLayer), amount: 999 })] })], today);
    expect(claims.map((c) => c.statement).join(" ")).not.toContain("999");
    expect(notes.join(" ")).toMatch(/discovery source and was not used/);
  });

  it("excludes versions not in effect today", () => {
    expect(licensureClaims([match({}, { effective_to: "2026-06-01" })], today).claims).toEqual([]);
    expect(licensureClaims([match({}, { effective_from: "2027-01-01" })], today).claims).toEqual([]);
  });

  it("excludes records with missing or future-dated provenance", () => {
    expect(licensureClaims([match({}, { source_url: "" })], today).claims).toEqual([]);
    expect(licensureClaims([match({}, { source_as_of: "2026-12-01" })], today).claims).toEqual([]);
  });

  it("drops malformed fees and never totals what it can't confirm", () => {
    const { claims, notes } = licensureClaims(
      [match({ fees: [fee({ amount: 175 }), fee({ fee_type: "application", amount: 85, currency: null })] })],
      today,
    );
    const feeClaim = claims.find((c) => c.statement.includes("Fees in effect"))!;
    expect(feeClaim.statement).toContain("USD 175.00");
    expect(feeClaim.statement).not.toContain("85");
    expect(notes.join(" ")).toMatch(/incomplete and was not used/);
  });

  it("says when the total is unconfirmed instead of guessing", () => {
    const { claims } = licensureClaims(
      [match({ fees: [fee({ amount: 175 }), fee({ fee_type: "background_check", amount_status: "variable", amount: null, currency: null })] })],
      today,
    );
    expect(claims[1].statement).toContain("Total cost to obtain can't be confirmed: Background check is not confirmed.");
  });

  it("gives no total when fees come from different sources", () => {
    const { claims, notes } = licensureClaims(
      [match({ fees: [fee({ amount: 175 }), fee({ fee_type: "application", amount: 85, source_url: "https://example.test/other" })] })],
      today,
    );
    expect(claims.filter((c) => c.statement.includes("Fees in effect"))).toHaveLength(2);
    expect(claims.some((c) => c.statement.includes("total"))).toBe(false);
    expect(notes.join(" ")).toMatch(/more than one source/);
  });

  it("notes when no verified fee schedule exists", () => {
    expect(licensureClaims([match()], today).notes.join(" ")).toMatch(/No verified fee schedule/);
  });

  it("for a fee-only source, dates the fees rather than the credential", () => {
    const { claims } = licensureClaims([match({ fees: [fee({ fee_type: "initial_license", amount: 140 })] }, { requirements: null })], today);
    expect(claims).toHaveLength(1);
    expect(claims[0].statement).toContain("Fees in effect since 2026-01-01");
    expect(claims[0].statement).not.toMatch(/Requirements/);
  });
});
