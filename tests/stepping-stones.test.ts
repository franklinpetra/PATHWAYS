import { describe, expect, it } from "vitest";
import { fieldsForSocCodes, matchSteppingStones, steppingStoneClaim } from "@/lib/agents/stepping-stones";
import type { SteppingStone } from "@/lib/db/types";

function program(overrides: Partial<SteppingStone> & { name: string }): SteppingStone {
  return {
    id: overrides.name,
    source_record_id: overrides.name,
    kind: "pre_apprenticeship",
    organization: null,
    summary: null,
    audiences: [],
    fields: [],
    paid: null,
    open_enrollment: true,
    street_address: null,
    city: "Seattle",
    county: "King",
    state: "WA",
    postal_code: null,
    statewide: false,
    latitude: null,
    longitude: null,
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    website: null,
    provenance: "official",
    source_name: "Recognized Apprenticeship Preparation Programs",
    source_url: "https://lni.wa.gov/x",
    observation_period: null,
    source_as_of: "2026-10-03",
    verification_authority: "Washington State Department of Labor & Industries",
    ...overrides,
  };
}

const anew = program({ name: "ANEW", audiences: ["women"], fields: [], city: "Tukwila" });
const carpenters = program({ name: "Carpenters Pre-Apprenticeship", fields: ["construction"], county: "King" });
const spokaneTrades = program({ name: "Spokane Trades", fields: ["construction"], county: "Spokane" });
const docProgram = program({ name: "Manufacturing Academy DOC", audiences: ["returning_citizens"], fields: ["manufacturing"] });
const youth = program({ name: "Skills Center", audiences: ["youth"], fields: ["construction"] });

describe("matchSteppingStones", () => {
  const all = [anew, carpenters, spokaneTrades, docProgram, youth];

  it("finds programs by field, local ones first", () => {
    expect(matchSteppingStones(all, { fields: ["construction"], audiences: [], county: "Spokane" }).map((p) => p.name)).toEqual([
      "Spokane Trades",
      "Carpenters Pre-Apprenticeship",
    ]);
  });

  it("puts programs for the person's own audience first, even outside their field", () => {
    expect(matchSteppingStones(all, { fields: ["construction"], audiences: ["women"], county: "King" })[0].name).toBe("ANEW");
  });

  it("never offers an audience-specific program to someone who didn't say they're in that audience", () => {
    const names = matchSteppingStones(all, { fields: ["construction", "manufacturing"], audiences: [], county: null }).map((p) => p.name);
    expect(names).not.toContain("Skills Center");
    expect(names).not.toContain("Manufacturing Academy DOC");
    expect(names).not.toContain("ANEW");
  });

  it("maps occupation codes to career fields", () => {
    expect(fieldsForSocCodes(["47-2031.00", "29-2052.00", "11-1021.00"]).sort()).toEqual(["construction", "healthcare"]);
  });
});

describe("steppingStoneClaim", () => {
  it("states L&I recognition, notes, and contact, sourced to L&I", () => {
    const claim = steppingStoneClaim(
      program({ name: "ANEW", city: "Tukwila", county: "King", contact_name: "Megan Clark", contact_phone: "206-381-1384", website: "https://www.anewcareer.org/" }),
    );
    expect(claim.statement).toBe(
      "ANEW (Tukwila, King County): recognized by Washington L&I as an apprenticeship preparation program (a pre-apprenticeship with formal agreements with registered apprenticeship sponsors). Contact: Megan Clark, 206-381-1384, https://www.anewcareer.org/.",
    );
    expect(claim.source.verificationAuthority).toBe("Washington State Department of Labor & Industries");
  });

  it("describes a curated program by its kind and pay, as its own site states", () => {
    const claim = steppingStoneClaim(
      program({ name: "FareStart", kind: "paid_training", paid: true, provenance: "program", summary: "Culinary job training." }),
    );
    expect(claim.statement).toMatch(
      /^FareStart \(Seattle, King County\): a paid training program that pays participants\. Its own website describes it as: Culinary job training\./,
    );
  });
});

describe("matchSteppingStones by distance", () => {
  const tacoma = { latitude: 47.2522, longitude: -122.4598 };
  const kent = program({ name: "Kent Trades", fields: ["construction"], county: "King", latitude: 47.3809, longitude: -122.2348 });
  const spokane = program({ name: "Spokane Trades", fields: ["construction"], county: "Spokane", latitude: 47.6588, longitude: -117.426 });
  const statewide = program({ name: "Statewide Trades", fields: ["construction"], statewide: true, county: null, latitude: null, longitude: null });

  it("keeps programs within reach and drops ones across the state", () => {
    const names = matchSteppingStones([spokane, kent, statewide], { fields: ["construction"], audiences: [], county: "Pierce", origin: tacoma }).map(
      (p) => p.name,
    );
    expect(names).toEqual(["Kent Trades", "Statewide Trades"]);
  });
});

describe("support services", () => {
  it("are told apart from training routes", async () => {
    const { isSupport } = await import("@/lib/agents/stepping-stones");
    expect(isSupport(program({ name: "CLEAR", kind: "support_service" }))).toBe(true);
    expect(isSupport(program({ name: "ANEW" }))).toBe(false);
  });

  it("match by audience alone, statewide, and stay hidden from people outside it", () => {
    const clear = program({ name: "CLEAR", kind: "support_service", audiences: ["returning_citizens"], statewide: true, county: null });
    expect(matchSteppingStones([clear], { fields: [], audiences: ["returning_citizens"], county: "Pierce" }).map((p) => p.name)).toEqual(["CLEAR"]);
    expect(matchSteppingStones([clear], { fields: ["construction"], audiences: [], county: "Pierce" })).toEqual([]);
  });
});
