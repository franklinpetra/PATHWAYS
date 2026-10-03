import { describe, expect, it } from "vitest";
import { joinArtsOpenData } from "@/lib/data/washington/arts-open-data";
import { joinCensusPlaces, placeName } from "@/lib/data/washington/census-places";
import { parseDelimited } from "@/lib/data/washington/csv";
import { makeStamp } from "@/lib/data/washington/sources";

// Fixture rows are fictional and exist only to exercise the joins.
const stamp = makeStamp("arts", { sourceUrl: "https://data.wa.gov/d/test", asOf: "2026-10-01", today: "2026-10-02" });

const programs = parseDelimited(
  [
    "ProgramID,ProgramName,ProgramStatus,ProgramURL,ContactName,ContactEmail,ContactPhone",
    "1,Example Pipe Trades JATC,Active,www.example.test,Pat Lee,pat@example.test,(253) 555-0100",
    "2,Closed Program,Cancelled,,,,",
    "3,Idaho Only Program,Active,,,,",
  ].join("\n"),
);
const occupations = parseDelimited(
  [
    "ProgramID,ProgramOccupationID,OccupationName,OccupationStatus,SOCCode,TermHours,Step1Wage,JourneyWage",
    "1,10,Plumber,Active,47-2152.02,\"10,000\",19.5,48.0865",
    "1,11,Retired Trade,InActive,47-2152.02,8000,18,40",
    "1,12,Pipefitter,Active,17-22112.03,8000,,",
    "2,20,Plumber,Active,47-2152.02,8000,18,40",
    "3,30,Electrician,Active,47-2111.00,8000,18,36",
  ].join("\n"),
);
const counties = parseDelimited(
  ["ProgramID,ProgramName,StateCode,CountyName", "1,x,WA,PIERCE", "1,x,WA,KING", "1,x,ID,KOOTENAI", "3,x,ID,KOOTENAI"].join("\n"),
);

describe("joinArtsOpenData", () => {
  const result = joinArtsOpenData({ programs, occupations, counties }, stamp);

  it("keeps only active program occupations with a Washington county", () => {
    expect(result.rows.map((r) => r.source_record_id)).toEqual(["10", "12"]);
    expect(result.skipped).toEqual({ inactive: 2, outsideWashington: 1 });
    expect(result.errors).toEqual([]);
  });

  it("joins sponsor, Washington counties, contact, hours, and wages rounded to the cent", () => {
    expect(result.rows[0]).toMatchObject({
      trade: "Plumber",
      sponsor: "Example Pipe Trades JATC",
      counties: ["King", "Pierce"],
      onet_soc_codes: ["47-2152.02"],
      term_hours: 10000,
      contact_url: "https://www.example.test/",
      starting_wage_hourly: 19.5,
      journey_wage_hourly: 48.09,
      source_as_of: "2026-10-01",
    });
  });

  it("keeps a program whose SOC code is malformed, without the code", () => {
    expect(result.rows[1]).toMatchObject({ trade: "Pipefitter", onet_soc_codes: [], starting_wage_hourly: null });
  });
});

describe("joinCensusPlaces", () => {
  const gazetteer = parseDelimited(
    [
      "USPS|GEOID|NAME|INTPTLAT|INTPTLONG",
      "WA|5370000|Tacoma city|47.2522|-122.4598",
      "WA|5307380|Bothell city|47.7735|-122.2045",
      "WA|5399999|Tacoma CDP|1|1",
    ].join("\n"),
    "|",
  );
  const placeByCounty = parseDelimited(
    [
      "STATE|COUNTYNAME|PLACEFP|PLACENAME",
      "WA|Pierce County|70000|Tacoma city",
      "WA|King County|07380|Bothell city",
      "WA|Snohomish County|07380|Bothell city",
    ].join("\n"),
    "|",
  );

  it("strips the census suffix", () => {
    expect(placeName("Aberdeen Gardens CDP")).toBe("Aberdeen Gardens");
  });

  it("gives a single-county place its county, a multi-county place none, and prefers incorporated names", () => {
    expect(joinCensusPlaces({ gazetteer, placeByCounty })).toEqual([
      { name: "Bothell", county: null, state: "WA", latitude: 47.7735, longitude: -122.2045 },
      { name: "Tacoma", county: "Pierce", state: "WA", latitude: 47.2522, longitude: -122.4598 },
    ]);
  });
});
