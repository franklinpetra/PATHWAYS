import { normalizeCounties } from "./fields";
import type { SourceStamp } from "./sources";

/**
 * Washington OEWS wage estimates from the Employment Security Department's annual data book
 * (the "Raw Data" sheet). Wages are hourly percentiles plus the annual mean; ESD marks
 * suppressed or annual-only figures with "-", which become null rather than a guess.
 */

export const ESD_OEWS_PAGE =
  "https://esd.wa.gov/jobs-and-training/labor-market-information/employment-and-wages/occupational-employment-and-wage-statistics-oews";

export const STATEWIDE_AREA = "Washington";

/**
 * Washington counties in each OEWS area, from the data book's index. Pierce County has no
 * area of its own in the data book, so it falls back to statewide estimates.
 */
export const AREA_COUNTIES: Record<string, readonly string[]> = {
  [STATEWIDE_AREA]: [],
  "Bellingham, WA": ["Whatcom"],
  "Bremerton-Silverdale-Port Orchard, WA": ["Kitsap"],
  "Kennewick-Richland, WA": ["Benton", "Franklin"],
  "Lewiston, ID-WA": ["Asotin"],
  "Longview-Kelso, WA": ["Cowlitz"],
  "Mount Vernon-Anacortes, WA": ["Skagit"],
  "Olympia-Lacey-Tumwater, WA": ["Thurston"],
  "Portland-Vancouver-Hillsboro, OR-WA": ["Clark", "Skamania"],
  "Seattle-Tacoma-Bellevue, WA": ["King", "Snohomish"],
  "Spokane-Spokane Valley, WA": ["Pend Oreille", "Spokane", "Stevens"],
  "Walla Walla, WA": ["Columbia", "Walla Walla"],
  "Wenatchee-East Wenatchee, WA": ["Chelan", "Douglas"],
  "Yakima, WA": ["Yakima"],
  "Eastern Washington nonmetropolitan area": [
    "Adams", "Ferry", "Garfield", "Grant", "Kittitas", "Klickitat", "Lincoln", "Okanogan", "Whitman",
  ],
  "Western Washington nonmetropolitan area": [
    "Clallam", "Grays Harbor", "Island", "Jefferson", "Lewis", "Mason", "Pacific", "San Juan", "Wahkiakum",
  ],
};

export interface OccupationWageRow extends SourceStamp {
  area_name: string;
  area_counties: string[];
  soc_code: string;
  title: string;
  employment: number | null;
  p25_hourly: number | null;
  median_hourly: number | null;
  p75_hourly: number | null;
  mean_annual: number | null;
}

const HEADER = [
  "Area Name",
  "SOC code",
  "Washington statewide occupational title",
  "Estimated employment",
  "Employment RSE",
  "25th percentile",
  "50th percentile",
  "75th percentile",
  "Mean hourly wage",
  "Annual mean wage",
] as const;

function figure(value: unknown, line: number, column: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && /^\s*[-*#]?\s*$/.test(value)) return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error(`row ${line}: ${column} "${value}" is not a number`);
  return n > 0 ? n : null;
}

/** Rows from the data book's "Raw Data" sheet (first row is the header), as table rows. */
export function parseEsdWages(
  sheet: unknown[][],
  stamp: SourceStamp,
): { rows: OccupationWageRow[]; errors: string[]; unknownAreas: string[] } {
  const [header, ...body] = sheet;
  const missing = HEADER.filter((h, i) => String(header?.[i] ?? "").trim() !== h);
  if (missing.length) throw new Error(`Unexpected "Raw Data" header; expected columns: ${HEADER.join(" | ")}`);

  const rows: OccupationWageRow[] = [];
  const errors: string[] = [];
  const unknownAreas = new Set<string>();
  body.forEach((r, i) => {
    const line = i + 2;
    const area = String(r[0] ?? "").trim();
    const soc = String(r[1] ?? "").trim();
    const title = String(r[2] ?? "").trim();
    if (!area || !soc) return;
    if (!(area in AREA_COUNTIES)) {
      unknownAreas.add(area);
      return;
    }
    // Summary rows ("00-0000", "15-0000") aren't occupations a person can be hired into.
    if (!/^\d{2}-\d{4}$/.test(soc) || /0000$/.test(soc)) return;
    try {
      const annual = figure(r[9], line, "Annual mean wage");
      rows.push({
        ...stamp,
        area_name: area,
        area_counties: normalizeCounties([...AREA_COUNTIES[area]]),
        soc_code: soc,
        title,
        employment: figure(r[3], line, "Estimated employment"),
        p25_hourly: figure(r[5], line, "25th percentile"),
        median_hourly: figure(r[6], line, "50th percentile"),
        p75_hourly: figure(r[7], line, "75th percentile"),
        mean_annual: annual === null ? null : Math.round(annual),
      });
    } catch (err) {
      errors.push((err as Error).message);
    }
  });
  return { rows, errors, unknownAreas: [...unknownAreas] };
}

/** The OEWS area whose counties include this county, or statewide when none does. */
export function areaForCounty(county: string | null): string {
  if (!county) return STATEWIDE_AREA;
  const key = county.toLowerCase();
  return (
    Object.entries(AREA_COUNTIES).find(([, counties]) => counties.some((c) => c.toLowerCase() === key))?.[0] ??
    STATEWIDE_AREA
  );
}
