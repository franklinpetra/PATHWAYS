import type { ApprenticeshipRow, RowError } from "./connectors";
import type { ParsedFile } from "./csv";
import { normalizeCounty, normalizeSocCode, parseUrl } from "./fields";
import type { SourceStamp } from "./sources";

/**
 * L&I publishes ARTS on data.wa.gov as three monthly datasets that share a ProgramID.
 * This joins them into one apprenticeship row per active program occupation, with the
 * Washington counties the program may operate in and its filed starting and journey wages.
 * Cancelled or inactive programs and occupations, and programs with no Washington county,
 * are left out.
 */

export const ARTS_DATASETS = {
  programs: "4mxd-hz2q",
  occupations: "6zih-i79k",
  counties: "euks-5kq7",
} as const;

export const ARTS_DATASET_PAGE = `https://data.wa.gov/d/${ARTS_DATASETS.occupations}`;

export function artsDownloadUrl(id: string): string {
  return `https://data.wa.gov/api/views/${id}/rows.csv?accessType=DOWNLOAD`;
}

export interface ArtsOpenDataRow extends ApprenticeshipRow {
  starting_wage_hourly: number | null;
  journey_wage_hourly: number | null;
}

export interface ArtsJoinResult {
  rows: ArtsOpenDataRow[];
  errors: RowError[];
  skipped: { inactive: number; outsideWashington: number };
}

const isActive = (status: string | undefined) => status?.trim().toLowerCase() === "active";

function blank(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function positiveInteger(value: string | undefined): number | null {
  const v = blank(value);
  if (!v) return null;
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isInteger(n) || n < 0) throw new Error(`"${v}" is not a whole number of hours`);
  return n > 0 ? n : null;
}

/** ARTS wages sometimes carry extra decimals ("48.0865"); they are rounded to the cent. */
function wage(value: string | undefined): number | null {
  const v = blank(value)?.replace(/[$,\s]/g, "");
  if (!v) return null;
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`"${value}" is not an hourly wage`);
  const n = Math.round(Number(v) * 100) / 100;
  return n > 0 ? n : null;
}

/** A malformed SOC code drops the code, not the program; the trade name still matches by text. */
function socCode(value: string | undefined): string[] {
  try {
    const v = blank(value);
    return v ? [normalizeSocCode(v)] : [];
  } catch {
    return [];
  }
}

export function joinArtsOpenData(
  files: { programs: ParsedFile; occupations: ParsedFile; counties: ParsedFile },
  stamp: SourceStamp,
): ArtsJoinResult {
  const programs = new Map(files.programs.records.map((r) => [r.values.ProgramID?.trim(), r.values]));

  const countiesByProgram = new Map<string, Set<string>>();
  const errors: RowError[] = [];
  for (const { line, values } of files.counties.records) {
    if (values.StateCode?.trim().toUpperCase() !== "WA") continue;
    let county: string | null;
    try {
      county = normalizeCounty(blank(values.CountyName));
    } catch (err) {
      errors.push({ line, message: (err as Error).message });
      continue;
    }
    if (!county) continue;
    const id = values.ProgramID.trim();
    if (!countiesByProgram.has(id)) countiesByProgram.set(id, new Set());
    countiesByProgram.get(id)!.add(county);
  }

  const rows: ArtsOpenDataRow[] = [];
  const skipped = { inactive: 0, outsideWashington: 0 };

  for (const { line, values } of files.occupations.records) {
    const program = programs.get(values.ProgramID?.trim());
    if (!program || !isActive(program.ProgramStatus) || !isActive(values.OccupationStatus)) {
      skipped.inactive++;
      continue;
    }
    const counties = [...(countiesByProgram.get(values.ProgramID.trim()) ?? [])].sort();
    if (counties.length === 0) {
      skipped.outsideWashington++;
      continue;
    }
    try {
      const id = blank(values.ProgramOccupationID);
      const trade = blank(values.OccupationName);
      const sponsor = blank(program.ProgramName);
      if (!id || !trade || !sponsor) throw new Error("ProgramOccupationID, OccupationName, and ProgramName are required");
      const email = blank(program.ContactEmail);
      rows.push({
        ...stamp,
        source_record_id: id,
        trade,
        sponsor,
        counties,
        onet_soc_codes: socCode(values.SOCCode),
        requirements: null,
        term_hours: positiveInteger(values.TermHours),
        contact_name: blank(program.ContactName),
        contact_phone: blank(program.ContactPhone),
        contact_email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
        contact_url: safeUrl(program.ProgramURL),
        starting_wage_hourly: wage(values.Step1Wage),
        journey_wage_hourly: wage(values.JourneyWage),
      });
    } catch (err) {
      errors.push({ line, message: (err as Error).message });
    }
  }

  return { rows, errors, skipped };
}

/** Program URLs are free text in ARTS; a malformed one is dropped rather than failing the row. */
function safeUrl(value: string | undefined): string | null {
  try {
    return parseUrl(blank(value));
  } catch {
    return null;
  }
}
