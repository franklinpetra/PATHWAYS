import { describe, expect, it } from "vitest";
import { incomeGapClaim, incomeTarget, incomeTargetClaim, localWages, payTransparencyClaim, wageClaim } from "@/lib/agents/income";
import { findUnsupportedFigures } from "@/lib/agents/grounding";
import { areaForCounty, parseEsdWages } from "@/lib/data/washington/esd-wages";
import { makeStamp } from "@/lib/data/washington/sources";
import type { OccupationWage } from "@/lib/db/types";

const stamp = makeStamp("esd_oews", { sourceUrl: "https://esd.wa.gov/media/xls/1/book", asOf: "2026-07-20", today: "2026-10-02" });

function wage(overrides: Partial<OccupationWage> = {}): OccupationWage {
  return {
    ...stamp,
    id: "w1",
    area_name: "Seattle-Tacoma-Bellevue, WA",
    area_counties: ["King", "Snohomish"],
    soc_code: "15-1252",
    title: "Software Developers",
    employment: 92770,
    p25_hourly: 65.64,
    median_hourly: 82.67,
    p75_hourly: 104.71,
    mean_annual: 179817,
    ...overrides,
  };
}

describe("incomeTarget", () => {
  it("is the income at which housing is 30% of gross income", () => {
    expect(incomeTarget(5000)).toEqual({ monthlyHousing: 5000, annual: 200000 });
    expect(incomeTarget(1850)).toEqual({ monthlyHousing: 1850, annual: 74000 });
  });

  it("is absent without a positive housing cost", () => {
    expect(incomeTarget(null)).toBeNull();
    expect(incomeTarget(0)).toBeNull();
    expect(incomeTarget(-5)).toBeNull();
  });

  it("states the target with HUD as its source", () => {
    const claim = incomeTargetClaim(incomeTarget(5000)!);
    expect(claim.statement).toBe(
      "HUD counts a household as cost burdened when housing takes more than 30% of income. At a housing cost of $5,000/month, staying within 30% takes a gross household income of at least $200,000/year ($16,667/month, or $96.15/hour at 2,080 full-time hours).",
    );
    expect(claim.source.verificationAuthority).toBe("U.S. Department of Housing and Urban Development");
  });
});

describe("wageClaim", () => {
  it("annualizes at 2,080 hours and compares the median and 75th percentile with the target", () => {
    const claim = wageClaim(wage(), incomeTarget(5000))!;
    expect(claim.statement).toBe(
      "Software Developers (SOC 15-1252), in the Seattle-Tacoma-Bellevue, WA area: median wage $82.67/hour ($171,954/year at 2,080 hours). " +
        "The middle half earn $65.64–$104.71/hour ($136,531–$217,797/year). About 92,770 people hold this job there. " +
        "Against the $200,000/year housing-based income target: the median falls short by $28,046/year; the 75th percentile meets it ($17,797/year above).",
    );
    expect(claim.source).toMatchObject({ verificationAuthority: "Washington State Employment Security Department", asOf: "2026-07-20" });
  });

  it("falls back to the annual mean when ESD publishes no hourly percentiles", () => {
    const claim = wageClaim(wage({ p25_hourly: null, median_hourly: null, p75_hourly: null, mean_annual: 163264 }), null)!;
    expect(claim.statement).toContain("Annual mean wage $163,264.");
    expect(wageClaim(wage({ median_hourly: null, mean_annual: null }), null)).toBeNull();
  });

  it("produces only figures the grounding check accepts when the reply repeats them", () => {
    const target = incomeTarget(5000)!;
    const claims = [incomeTargetClaim(target), wageClaim(wage(), target)!];
    const reply = "You need $200,000/year ($16,667/month). The median is $171,954, short by $28,046; the 75th percentile, $217,797, clears it by $17,797.";
    expect(findUnsupportedFigures(reply, claims)).toEqual([]);
  });
});

describe("localWages", () => {
  it("prefers the person's area over statewide and orders by pay", () => {
    const rows = [
      wage({ area_name: "Washington", median_hourly: 82.31 }),
      wage(),
      wage({ area_name: "Washington", soc_code: "15-1254", title: "Web Developers", median_hourly: 64.47 }),
    ];
    expect(localWages(rows, "Seattle-Tacoma-Bellevue, WA").map((w) => [w.soc_code, w.area_name])).toEqual([
      ["15-1252", "Seattle-Tacoma-Bellevue, WA"],
      ["15-1254", "Washington"],
    ]);
  });
});

describe("ESD wages", () => {
  const header = [
    "Area Name", "SOC code", "Washington statewide occupational title", "Estimated employment", "Employment RSE",
    "25th percentile", "50th percentile", "75th percentile", "Mean hourly wage", "Annual mean wage", "Mean wage RSE", "Index",
  ];

  it("parses occupations, skips summary rows, and turns suppressed figures into null", () => {
    const { rows, errors, unknownAreas } = parseEsdWages(
      [
        header,
        ["Washington", "00-0000", "Total all occupations", 3550970, 0, 23.12, 30.96, 50, 40.96, 85200, 0.4],
        ["Washington", "25-1011", "Business Teachers, Postsecondary", 1190, 2, "-", "-", "-", "-", 119165, 0.9],
        ["Seattle-Tacoma-Bellevue, WA", "15-1252", "Software Developers", 92770, 1.9, 65.64, 82.67, 104.71, 86.44, 179817, 1.3],
        ["Somewhere Else, OR", "15-1252", "Software Developers", 1, 1, 1, 1, 1, 1, 1, 1],
      ],
      stamp,
    );
    expect(errors).toEqual([]);
    expect(unknownAreas).toEqual(["Somewhere Else, OR"]);
    expect(rows.map((r) => [r.area_name, r.soc_code, r.median_hourly, r.mean_annual])).toEqual([
      ["Washington", "25-1011", null, 119165],
      ["Seattle-Tacoma-Bellevue, WA", "15-1252", 82.67, 179817],
    ]);
    expect(rows[1].area_counties).toEqual(["King", "Snohomish"]);
  });

  it("rejects a changed header rather than misreading columns", () => {
    expect(() => parseEsdWages([["Area", "SOC"]], stamp)).toThrow(/Unexpected "Raw Data" header/);
  });

  it("maps counties to their area, with Pierce and unknowns statewide", () => {
    expect(areaForCounty("King")).toBe("Seattle-Tacoma-Bellevue, WA");
    expect(areaForCounty("Spokane")).toBe("Spokane-Spokane Valley, WA");
    expect(areaForCounty("Pierce")).toBe("Washington");
    expect(areaForCounty(null)).toBe("Washington");
  });
});

describe("incomeGapClaim", () => {
  it("states the gap and the side-work hours at the best median wage", () => {
    const target = incomeTarget(5000)!;
    const claim = incomeGapClaim(target, [wage({ title: "Web Developers", median_hourly: 64.47 }), wage({ median_hourly: 82.31 })])!;
    // $200,000 - $171,205 = $28,795/year = $2,400/month (rounded up); $2,400 / $82.31 = 29.2 -> 30 hours.
    expect(claim.statement).toBe(
      "The highest median wage found, Software Developers at $171,205/year, leaves $28,795/year ($2,400/month) to reach the $200,000/year target. " +
        "At that occupation's median of $82.31/hour, closing it takes about 30 hours a month of paid side work, or a second household income of at least $28,795/year.",
    );
    expect(findUnsupportedFigures("You'd still need $2,400/month, about 30 hours at $82.31.", [claim])).toEqual([]);
  });

  it("is absent when a median already meets the target or no median is published", () => {
    expect(incomeGapClaim(incomeTarget(3000)!, [wage()])).toBeNull();
    expect(incomeGapClaim(incomeTarget(5000)!, [wage({ median_hourly: null })])).toBeNull();
  });
});

describe("payTransparencyClaim", () => {
  it("quotes RCW 49.58.110 from the Legislature", () => {
    const claim = payTransparencyClaim();
    expect(claim.statement).toContain('"This section only applies to employers with 15 or more employees."');
    expect(claim.source).toMatchObject({ verificationAuthority: "Washington State Legislature", url: "https://app.leg.wa.gov/RCW/default.aspx?cite=49.58.110" });
  });
});
