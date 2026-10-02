import { describe, expect, it } from "vitest";
import { parseDelimited } from "@/lib/data/washington/csv";
import { artsConnector, onetConnector, runConnector, trainingConnector } from "@/lib/data/washington/connectors";
import { normalizeCounties, normalizeSocCode, parseMoney, parseRate } from "@/lib/data/washington/fields";
import { makeStamp } from "@/lib/data/washington/sources";

// Fixture rows are fictional and exist only to exercise parsing.
const stamp = makeStamp("career_bridge", {
  sourceUrl: "https://example.test/export",
  asOf: "2026-09-15",
  today: "2026-10-01",
});

describe("parseDelimited", () => {
  it("handles quotes, escaped quotes, embedded newlines, CRLF, and a BOM", () => {
    const file = parseDelimited('﻿a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",2\r\n');
    expect(file.headers).toEqual(["a", "b"]);
    expect(file.records).toEqual([
      { line: 2, values: { a: "x, y", b: 'say "hi"' } },
      { line: 3, values: { a: "multi\nline", b: "2" } },
    ]);
  });

  it("detects tab-delimited files and skips blank lines", () => {
    const file = parseDelimited("O*NET-SOC Code\tTitle\n\n29-1141.00\tRegistered Nurses\n");
    expect(file.records).toHaveLength(1);
    expect(file.records[0].values["Title"]).toBe("Registered Nurses");
  });
});

describe("field normalizers", () => {
  it("normalizes SOC codes", () => {
    expect(normalizeSocCode("29-1141")).toBe("29-1141.00");
    expect(normalizeSocCode("291141")).toBe("29-1141.00");
    expect(normalizeSocCode("47-2111.01")).toBe("47-2111.01");
    expect(() => normalizeSocCode("nurse")).toThrow();
  });

  it("normalizes Washington counties and expands statewide", () => {
    expect(normalizeCounties(["pierce county", "King"])).toEqual(["Pierce", "King"]);
    expect(normalizeCounties(["Statewide"])).toHaveLength(39);
    expect(() => normalizeCounties(["Multnomah"])).toThrow(/not a Washington county/);
  });

  it("parses money and rates", () => {
    expect(parseMoney("$4,250.00")).toBe(4250);
    expect(parseMoney("")).toBeNull();
    expect(() => parseMoney("about 4k")).toThrow();
    expect(parseRate("62%")).toBe(0.62);
    expect(parseRate("0.62")).toBe(0.62);
    expect(parseRate("62")).toBe(0.62);
    expect(() => parseRate("140%")).toThrow();
  });
});

describe("makeStamp", () => {
  it("requires a valid, non-future as-of date and an http(s) URL", () => {
    expect(() => makeStamp("arts", { sourceUrl: "https://x.test", asOf: "2026-13-01" })).toThrow();
    expect(() => makeStamp("arts", { sourceUrl: "https://x.test", asOf: "2026-12-01", today: "2026-10-01" })).toThrow(/future/);
    expect(() => makeStamp("arts", { sourceUrl: "ftp://x.test", asOf: "2026-09-01", today: "2026-10-01" })).toThrow();
  });

  it("stamps the named authority", () => {
    expect(makeStamp("arts", { sourceUrl: "https://x.test", asOf: "2026-09-01", today: "2026-10-01" })).toMatchObject({
      verification_authority: "Washington State Department of Labor & Industries",
    });
  });
});

describe("ARTS connector", () => {
  const arts = makeStamp("arts", { sourceUrl: "https://example.test/arts", asOf: "2026-09-01", today: "2026-10-01" });

  it("maps alternate headers and normalizes fields", () => {
    const file = parseDelimited(
      [
        "Program Number,Occupation,Program Sponsor,Counties Served,SOC Code,Minimum Requirements,Term Hours,Contact,Phone,Email,Website",
        'A-100,Example Trade,Example Sponsor JATC,"Pierce County; King County",47-2111,Age 18; HS diploma or GED,"8,000",Pat Example,555-0100,pat@example.test,example.test',
      ].join("\n"),
    );
    const result = runConnector(artsConnector, file, arts);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      source_record_id: "A-100",
      trade: "Example Trade",
      counties: ["Pierce", "King"],
      onet_soc_codes: ["47-2111.00"],
      term_hours: 8000,
      contact_url: "https://example.test/",
      source_name: "Apprenticeship Registration and Tracking System (ARTS)",
    });
  });

  it("reports missing columns instead of guessing", () => {
    const result = runConnector(artsConnector, parseDelimited("Trade,Sponsor\nX,Y\n"), arts);
    expect(result.missingColumns).toEqual(["program_id", "counties"]);
    expect(result.rows).toEqual([]);
  });

  it("rejects bad rows with line numbers and keeps good ones", () => {
    const file = parseDelimited(
      "Program ID,Trade,Sponsor,County,Email\nA-1,T,S,Pierce,a@b.test\nA-2,T,S,Multnomah,\nA-3,T,S,King,not-an-email\nA-1,T,S,King,\n",
    );
    const result = runConnector(artsConnector, file, arts);
    expect(result.rows.map((r) => r.source_record_id)).toEqual(["A-1"]);
    expect(result.errors).toEqual([
      { line: 3, message: '"Multnomah" is not a Washington county' },
      { line: 4, message: '"not-an-email" is not an email address' },
      { line: 5, message: "duplicate record in this file" },
    ]);
  });
});

describe("training connector", () => {
  it("maps program fields, rates, and coordinates", () => {
    const file = parseDelimited(
      [
        "Program ID,Program Name,Provider,Award,Estimated Cost,Cost Basis,Completion Rate,Reporting Period,Address,City,County,Zip,Latitude,Longitude",
        "P-1,Example Program,Example College,Certificate,\"$3,100\",Tuition and fees for the full program,58%,2023-24 cohort,100 Example St,Tacoma,Pierce,98400,47.25,-122.44",
      ].join("\n"),
    );
    const result = runConnector(trainingConnector, file, stamp);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      title: "Example Program",
      provider_name: "Example College",
      credential_type: "Certificate",
      estimated_cost_usd: 3100,
      completion_rate: 0.58,
      observation_period: "2023-24 cohort",
      county: "Pierce",
      latitude: 47.25,
      verification_authority: "Washington Workforce Training and Education Coordinating Board",
    });
  });

  it("refuses figures that can't be attributed: cost without basis, rate without period", () => {
    const file = parseDelimited("Program ID,Program Name,Provider,Estimated Cost,Completion Rate\nP-1,X,Y,$100,\nP-2,X,Y,,50%\n");
    const result = runConnector(trainingConnector, file, stamp);
    expect(result.rows).toEqual([]);
    expect(result.errors.map((e) => e.line)).toEqual([2, 3]);
  });
});

describe("O*NET connector", () => {
  it("reads the Occupation Data layout", () => {
    const onet = makeStamp("onet", { sourceUrl: "https://example.test/onet", asOf: "2026-08-01", today: "2026-10-01" });
    const file = parseDelimited("O*NET-SOC Code\tTitle\tDescription\n29-1141.00\tRegistered Nurses\tAssess patient health problems.\n");
    expect(runConnector(onetConnector, file, onet).rows[0]).toMatchObject({
      onet_soc_code: "29-1141.00",
      title: "Registered Nurses",
      source_name: "O*NET OnLine",
    });
  });
});
