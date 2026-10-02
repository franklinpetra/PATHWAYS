import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { excerptProblems, normalizeForMatch, parsePacket, reviewProblems, type LicensurePacket } from "@/lib/data/licensure/packet";

const draft = JSON.parse(readFileSync("data/licensure/wa/wac-246-945-990.json", "utf8"));
// The official text as retrieved, kept so the committed packet is checked in CI without network access.
const wacText = readFileSync("tests/fixtures/wac-246-945-990.txt", "utf8");

function packet(mutate: (p: LicensurePacket) => void = () => {}): LicensurePacket {
  const copy = structuredClone(draft);
  mutate(copy);
  return copy;
}

function errors(p: unknown): string[] {
  const r = parsePacket(p);
  return "errors" in r ? r.errors : [];
}

describe("the WAC 246-945-990 draft packet", () => {
  it("is a valid packet", () => {
    expect(errors(draft)).toEqual([]);
  });

  it("traces every excerpt and stated fee to the official text", () => {
    expect(excerptProblems(packet(), wacText)).toEqual([]);
  });

  it("is still a draft awaiting review", () => {
    expect(reviewProblems(packet(), "2026-10-02")).toHaveLength(3);
  });

  it("keeps fees outside the WAC as unknown, so totals stay unconfirmed", () => {
    for (const c of draft.credentials) {
      const unknown = c.fees.filter((f: { status: string }) => f.status === "unknown").map((f: { type: string }) => f.type);
      expect(unknown.sort()).toEqual(["background_check", "exam"]);
    }
  });
});

describe("packet validation fails closed", () => {
  it.each([
    ["known fee without currency", (p: LicensurePacket) => (p.credentials[0].fees[0].currency = null)],
    ["known fee of zero", (p: LicensurePacket) => (p.credentials[0].fees[0].amount = 0)],
    ["zero fee with an amount", (p: LicensurePacket) => Object.assign(p.credentials[0].fees[0], { status: "zero", amount: 5 })],
    ["unknown fee with an amount", (p: LicensurePacket) => (p.credentials[0].fees[4].amount = 45)],
    ["known fee without its source row label", (p: LicensurePacket) => (p.credentials[0].fees[0].source_label = null)],
    ["lowercase currency", (p: LicensurePacket) => (p.credentials[0].fees[0].currency = "usd")],
    ["fractional cents", (p: LicensurePacket) => (p.credentials[0].fees[0].amount = 140.005)],
    ["unlabelled other fee", (p: LicensurePacket) => (p.credentials[0].fees[3].label = null)],
    ["issuer not listed", (p: LicensurePacket) => (p.credentials[0].issuer = "Someone Else")],
    ["discovery authority as source", (p: LicensurePacket) => (p.authorities[0].role = "discovery")],
    ["malformed occupation code", (p: LicensurePacket) => (p.credentials[0].occupations = ["29-2052"])],
    ["duplicate fee", (p: LicensurePacket) => p.credentials[0].fees.push({ ...p.credentials[0].fees[0] })],
    ["retrieved before effective", (p: LicensurePacket) => (p.source.retrieved_on = "2020-01-01")],
  ])("rejects %s", (_label, mutate) => {
    expect(errors(packet(mutate))).not.toEqual([]);
  });
});

describe("excerpt checks", () => {
  it("catches a mistyped amount", () => {
    expect(excerptProblems(packet((p) => (p.credentials[0].fees[0].amount = 150)), wacText)).toEqual([
      'Pharmacy Technician: "Initial credential" with 150.00 is not in its excerpts',
    ]);
  });

  it("catches an excerpt that isn't in the source", () => {
    const problems = excerptProblems(
      packet((p) => (p.credentials[1].excerpts[1] = "(e) Pharmacy assistant: Initial credential $75.00")),
      wacText,
    );
    expect(problems).toContain("Pharmacy Assistant: excerpt 2 is not in the source text");
  });

  it("catches a fee attached to the wrong row", () => {
    expect(excerptProblems(packet((p) => (p.credentials[1].fees[2].amount = 70)), wacText)).toEqual([
      'Pharmacy Assistant: "Late renewal penalty" with 70.00 is not in its excerpts',
    ]);
  });

  it("matches across table markup, currency signs, and spacing", () => {
    expect(normalizeForMatch("Initial credential | $140.00 |")).toBe(normalizeForMatch("Initial credential 140.00"));
  });
});

describe("review gate", () => {
  it("passes a reviewed packet", () => {
    const reviewed = packet((p) => {
      p.status = "reviewed";
      p.review.reviewed_by = "Reviewer";
      p.review.reviewed_on = "2026-10-02";
    });
    expect(reviewProblems(reviewed, "2026-10-02")).toEqual([]);
  });

  it("rejects a review dated in the future", () => {
    const p = packet((x) => Object.assign(x, { status: "reviewed", review: { reviewed_by: "R", reviewed_on: "2026-12-01", notes: [] } }));
    expect(reviewProblems(p, "2026-10-02")).toEqual(["review.reviewed_on is in the future"]);
  });
});
