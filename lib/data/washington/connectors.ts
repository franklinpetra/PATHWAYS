import {
  fieldReader,
  hasField,
  normalizeCounties,
  normalizeCounty,
  normalizeSocCode,
  parseCoordinate,
  parseInteger,
  parseMoney,
  parseRate,
  parseUrl,
  splitList,
} from "./fields";
import type { ParsedFile } from "./csv";
import type { SourceKey, SourceStamp } from "./sources";

/**
 * Connectors map a source export to table rows. Each field lists the header names it
 * accepts (matched case- and punctuation-insensitively). Exports change: run the seed
 * script with --dry-run first, and add a header here if a column isn't recognized.
 */

export interface RowError {
  line: number;
  message: string;
}

export interface ConnectorResult<T> {
  rows: T[];
  errors: RowError[];
  /** Required columns missing from the header row; when non-empty, no rows are produced. */
  missingColumns: string[];
}

type Read = ReturnType<typeof fieldReader>;

export interface Connector<T> {
  table: "apprenticeships" | "training_programs" | "occupations" | "places";
  /** Upsert conflict target. */
  conflict: string;
  required: Record<string, readonly string[]>;
  toRow: (read: Read, stamp: SourceStamp) => T;
}

function socCodes(value: string | null): string[] {
  return [...new Set(splitList(value).map(normalizeSocCode))];
}

function required(read: Read, aliases: readonly string[], name: string): string {
  const value = read(aliases);
  if (!value) throw new Error(`${name} is blank`);
  return value;
}

// ---------------------------------------------------------------------------
// Washington L&I ARTS: registered apprenticeships
// ---------------------------------------------------------------------------

const ARTS = {
  id: ["program_id", "program number", "program no", "program #", "id"],
  trade: ["trade", "occupation", "occupation title", "apprenticeable occupation"],
  sponsor: ["sponsor", "program sponsor", "sponsor name", "program name"],
  counties: ["counties", "county", "counties served", "geographic area", "area served"],
  soc: ["onet_soc_codes", "o*net code", "onet code", "onet soc code", "soc code", "soc"],
  requirements: ["requirements", "minimum requirements", "minimum qualifications", "entry requirements"],
  termHours: ["term_hours", "term hours", "term (hours)", "ojt hours", "hours"],
  contactName: ["contact_name", "contact", "contact person"],
  contactPhone: ["contact_phone", "phone", "contact phone"],
  contactEmail: ["contact_email", "email", "contact email"],
  contactUrl: ["contact_url", "website", "web site", "url"],
} as const;

export interface ApprenticeshipRow extends SourceStamp {
  source_record_id: string;
  trade: string;
  sponsor: string;
  counties: string[];
  onet_soc_codes: string[];
  requirements: string | null;
  term_hours: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_url: string | null;
}

export const artsConnector: Connector<ApprenticeshipRow> = {
  table: "apprenticeships",
  conflict: "source_name,source_record_id",
  required: { program_id: ARTS.id, trade: ARTS.trade, sponsor: ARTS.sponsor, counties: ARTS.counties },
  toRow: (read, stamp) => {
    const counties = normalizeCounties(splitList(read(ARTS.counties)));
    if (counties.length === 0) throw new Error("counties is blank");
    const email = read(ARTS.contactEmail);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${email}" is not an email address`);
    return {
      ...stamp,
      source_record_id: required(read, ARTS.id, "program_id"),
      trade: required(read, ARTS.trade, "trade"),
      sponsor: required(read, ARTS.sponsor, "sponsor"),
      counties,
      onet_soc_codes: socCodes(read(ARTS.soc)),
      requirements: read(ARTS.requirements),
      term_hours: parseInteger(read(ARTS.termHours)),
      contact_name: read(ARTS.contactName),
      contact_phone: read(ARTS.contactPhone),
      contact_email: email,
      contact_url: parseUrl(read(ARTS.contactUrl)),
    };
  },
};

// ---------------------------------------------------------------------------
// Career Bridge / SBCTC: education and technical training programs
// ---------------------------------------------------------------------------

const TRAINING = {
  id: ["program_id", "program id", "program number", "id"],
  name: ["program_name", "program name", "program", "program title", "title"],
  provider: ["provider", "provider name", "school", "institution", "college"],
  credential: ["credential", "credential type", "award", "award type", "degree"],
  cip: ["cip_code", "cip", "cip code"],
  soc: ["onet_soc_codes", "o*net code", "onet code", "onet soc code", "soc code", "soc"],
  cost: ["estimated_cost", "estimated cost", "total cost", "cost", "tuition and fees"],
  costBasis: ["cost_basis", "cost basis", "cost includes", "cost description"],
  completion: ["completion_rate", "completion rate", "completion", "program completion rate"],
  period: ["observation_period", "observation period", "reporting period", "cohort", "data year"],
  street: ["street_address", "street address", "address", "address 1"],
  city: ["city"],
  county: ["county"],
  postal: ["postal_code", "zip", "zip code", "postal code"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lon", "lng", "long"],
  url: ["source_url", "program url", "program page", "url", "website"],
} as const;

export interface TrainingProgramRow extends SourceStamp {
  source_record_id: string;
  title: string;
  provider_name: string;
  credential_type: string | null;
  cip_code: string | null;
  onet_soc_codes: string[];
  estimated_cost_usd: number | null;
  cost_basis: string | null;
  completion_rate: number | null;
  street_address: string | null;
  city: string | null;
  county: string | null;
  state: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
}

export const trainingConnector: Connector<TrainingProgramRow> = {
  table: "training_programs",
  conflict: "source_name,source_record_id",
  required: { program_id: TRAINING.id, program_name: TRAINING.name, provider: TRAINING.provider },
  toRow: (read, stamp) => {
    const cost = parseMoney(read(TRAINING.cost));
    const completion = parseRate(read(TRAINING.completion));
    // A figure without its basis or period can't be attributed honestly.
    const costBasis = read(TRAINING.costBasis);
    if (cost !== null && !costBasis) throw new Error("estimated_cost needs cost_basis (what the cost covers)");
    const period = read(TRAINING.period) ?? stamp.observation_period;
    if (completion !== null && !period) {
      throw new Error("completion_rate needs an observation period (column or --observation-period)");
    }
    const latitude = parseCoordinate(read(TRAINING.latitude), "latitude");
    const longitude = parseCoordinate(read(TRAINING.longitude), "longitude");
    if ((latitude === null) !== (longitude === null)) throw new Error("latitude and longitude must be given together");
    return {
      ...stamp,
      source_url: parseUrl(read(TRAINING.url)) ?? stamp.source_url,
      observation_period: period,
      source_record_id: required(read, TRAINING.id, "program_id"),
      title: required(read, TRAINING.name, "program_name"),
      provider_name: required(read, TRAINING.provider, "provider"),
      credential_type: read(TRAINING.credential),
      cip_code: read(TRAINING.cip),
      onet_soc_codes: socCodes(read(TRAINING.soc)),
      estimated_cost_usd: cost,
      cost_basis: costBasis,
      completion_rate: completion,
      street_address: read(TRAINING.street),
      city: read(TRAINING.city),
      county: normalizeCounty(read(TRAINING.county)),
      state: "WA",
      postal_code: read(TRAINING.postal),
      latitude,
      longitude,
    };
  },
};

// ---------------------------------------------------------------------------
// O*NET occupations ("Occupation Data" file)
// ---------------------------------------------------------------------------

const ONET = {
  code: ["o*net-soc code", "onet soc code", "onet_soc_code", "code"],
  title: ["title", "occupation"],
  description: ["description"],
} as const;

export interface OccupationRow extends SourceStamp {
  onet_soc_code: string;
  title: string;
  description: string | null;
}

export const onetConnector: Connector<OccupationRow> = {
  table: "occupations",
  conflict: "onet_soc_code",
  required: { onet_soc_code: ONET.code, title: ONET.title },
  toRow: (read, stamp) => ({
    ...stamp,
    onet_soc_code: normalizeSocCode(required(read, ONET.code, "onet_soc_code")),
    title: required(read, ONET.title, "title"),
    description: read(ONET.description),
  }),
};

// ---------------------------------------------------------------------------

export const CONNECTORS = {
  arts: artsConnector,
  career_bridge: trainingConnector,
  sbctc: trainingConnector,
  onet: onetConnector,
} satisfies Record<SourceKey, Connector<unknown>>;

export function runConnector<T>(connector: Connector<T>, file: ParsedFile, stamp: SourceStamp): ConnectorResult<T> {
  const missingColumns = Object.entries(connector.required)
    .filter(([, aliases]) => !hasField(file.headers, aliases))
    .map(([name]) => name);
  if (missingColumns.length > 0) return { rows: [], errors: [], missingColumns };

  const rows: T[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  for (const record of file.records) {
    try {
      const row = connector.toRow(fieldReader(record.values), stamp);
      const key = connector.conflict
        .split(",")
        .map((k) => String((row as Record<string, unknown>)[k]))
        .join("|");
      if (seen.has(key)) throw new Error("duplicate record in this file");
      seen.add(key);
      rows.push(row);
    } catch (err) {
      errors.push({ line: record.line, message: (err as Error).message });
    }
  }
  return { rows, errors, missingColumns };
}
