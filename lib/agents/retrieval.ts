import "server-only";
import { z } from "zod";
import { generateStructured, generateStructuredWithWeb } from "@/lib/ai/openrouter";
import { normalizeCounty } from "@/lib/data/washington/fields";
import { licensureClaims } from "@/lib/data/licensure/claims";
import {
  findOccupations,
  findPlace,
  searchApprenticeships,
  searchCredentials,
  searchTrainingPrograms,
} from "@/lib/db/queries";
import type { Apprenticeship, ContextItem, Occupation, Place, SourceColumns, TrainingProgramMatch } from "@/lib/db/types";
import type { SourceAttribution } from "@/lib/workspace/events";
import { supportedClaims } from "./grounding";
import { OFFICIAL_FACTS_PROMPT, OFFICIAL_SOURCES, officialFactsSchema, verifyOfficialFacts, type OfficialClaim } from "./official-sources";
import { STATE_APPRENTICESHIP_OFFICE } from "./prompt";

/**
 * Fact-Finder Agent.
 *
 * The model's only job here is to extract search parameters. Every claim is then
 * assembled deterministically from rows in the Washington source tables (O*NET,
 * Career Bridge / SBCTC training programs, L&I ARTS apprenticeships, licensure records),
 * each carrying its source name, observation period, as-of date, and verification
 * authority. Claims without complete, dated provenance are dropped before the prompt.
 * If the tables have nothing, the agent says the fact is unconfirmed; an empty result is
 * never presented as proof that an opportunity doesn't exist.
 *
 * In parallel, a live search of official sources (see official-sources.ts) answers the rules,
 * requirements, and steps the tables don't hold. Its facts are verified against the retrieved
 * page text before they become claims, and a slow or failed search never blocks the reply.
 */

const DEFAULT_RADIUS_MILES = 25;
const OFFICIAL_SEARCH_TIMEOUT_MS = 20_000;
const OFFICIAL_SEARCH_RESULTS = 8;
const MAX_RADIUS_MILES = 100;

const lookupParamsSchema = z.object({
  needs_lookup: z
    .boolean()
    .describe("True only if answering well requires programs, apprenticeships, or occupation data for a specific field."),
  occupation: z.string().nullable().describe("Occupation, trade, or field in plain words, e.g. 'electrician'."),
  location: z.string().nullable().describe("City or county name only, e.g. 'Tacoma' or 'Pierce County'. Null if not stated."),
  radius_miles: z.number().nullable().describe("Only if the person stated a distance."),
  official_query: z
    .string()
    .nullable()
    .describe(
      "A web search query for official sources on the rules, requirements, steps, fees, permits, licenses, or program prerequisites this message depends on, e.g. 'Washington pharmacy technician license requirements' or 'Tacoma food truck permit'. Null if the message needs no such facts.",
    ),
});

export type LookupParams = z.infer<typeof lookupParamsSchema>;

const SYSTEM_PROMPT = `Extract search parameters from a person's message about education, training, apprenticeships, or careers in Washington State.
Use their known context for a location if the message does not name one.
Only extract what is stated or recorded. Never guess an occupation or location.`;

export interface SourcedClaim {
  /** Stable reference, e.g. "program:<uuid>" or "occupation:29-1141.00". */
  id: string;
  kind: "occupation" | "program" | "apprenticeship" | "licensure" | "official";
  statement: string;
  source: SourceAttribution;
  /** Present when the source gives a street address. */
  place?: { name: string; address: string; latitude: number | null; longitude: number | null };
}

export interface FactFindings {
  params: LookupParams | null;
  claims: SourcedClaim[];
  /** Plain-language record of what was searched and found, including empty results. */
  notes: string[];
}

export interface RetrievalInput {
  userMessage: string;
  contextItems: ContextItem[];
  signal?: AbortSignal;
}

export async function findFacts(input: RetrievalInput): Promise<FactFindings> {
  const context = input.contextItems
    .filter((i) => i.temporal_status === "current")
    .map((i) => `- ${i.display_text}`)
    .join("\n");

  const params = await generateStructured({
    name: "lookup_parameters",
    schema: lookupParamsSchema,
    temperature: 0,
    signal: input.signal,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Known context:\n${context || "(none)"}\n\nMessage:\n${input.userMessage}` },
    ],
  });

  const today = new Date().toISOString().slice(0, 10);
  const official = params.official_query?.trim()
    ? findOfficialFacts(params.official_query.trim(), today, input.signal)
    : Promise.resolve({ claims: [], notes: [] });
  const tables = findTableFacts(params, today);
  const [fromTables, fromOfficial] = await Promise.all([tables, official]);
  return {
    params,
    claims: [...fromTables.claims, ...fromOfficial.claims],
    notes: [...fromTables.notes, ...fromOfficial.notes],
  };
}

async function findOfficialFacts(
  query: string,
  today: string,
  signal?: AbortSignal,
): Promise<{ claims: OfficialClaim[]; notes: string[] }> {
  const timeout = AbortSignal.timeout(OFFICIAL_SEARCH_TIMEOUT_MS);
  try {
    const { data, citations } = await generateStructuredWithWeb({
      name: "official_facts",
      schema: officialFactsSchema,
      temperature: 0,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      web: { maxResults: OFFICIAL_SEARCH_RESULTS, includeDomains: OFFICIAL_SOURCES.map((s) => s.domain) },
      messages: [
        { role: "system", content: OFFICIAL_FACTS_PROMPT },
        { role: "user", content: `Question: ${query}\nLocation: Washington State, unless the question names somewhere else.` },
      ],
    });
    const { claims, dropped } = verifyOfficialFacts(data.facts, citations, today);
    const notes = [`Official-source search for "${query}": ${count(claims.length)}.`];
    if (dropped > 0) notes.push(`${dropped} search result${dropped === 1 ? " was" : "s were"} left out because the quoted text couldn't be verified.`);
    return { claims, notes };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error("[fact-finder] official-source search failed", err);
    return { claims: [], notes: [] };
  }
}

async function findTableFacts(params: LookupParams, today: string): Promise<{ claims: SourcedClaim[]; notes: string[] }> {
  const phrase = params.occupation?.trim();
  if (!params.needs_lookup || !phrase) return { claims: [], notes: [] };

  const notes: string[] = [];
  const { place, county } = await resolveLocation(params.location, notes);
  const radius = place ? clampRadius(params.radius_miles) : null;

  const occupations = await findOccupations(phrase);
  const socCodes = occupations.map((o) => o.onet_soc_code);
  if (occupations.length === 0) notes.push(`No occupation in the O*NET table matched "${phrase}" (unconfirmed, not proof it doesn't exist).`);

  const [programs, apprenticeships, credentials] = await Promise.all([
    socCodes.length
      ? searchTrainingPrograms({
          socCodes,
          latitude: place?.latitude ?? null,
          longitude: place?.longitude ?? null,
          radiusMiles: radius,
        })
      : Promise.resolve([]),
    searchApprenticeships({ socCodes, trade: phrase, county }),
    searchCredentials({ socCodes, on: today }),
  ]);
  const licensure = licensureClaims(credentials, today);

  const field = occupations.length ? occupations.map((o) => o.title).join(", ") : `"${phrase}"`;
  if (socCodes.length) {
    notes.push(
      `Training program search for ${field}${place ? ` within ${radius} miles of ${place.name}, ${place.state}` : ""}: ${count(programs.length)}.`,
    );
    notes.push(
      `Licensure search for ${field} in Washington: ${count(credentials.length)}${credentials.length ? "" : " (licensure requirements and fees unconfirmed)"}.`,
    );
  }
  notes.push(`Registered apprenticeship search for ${field}${county ? ` in ${county} County` : ""}: ${count(apprenticeships.length)}.`);
  if (apprenticeships.length === 0) {
    notes.push(`No apprenticeship record found: unconfirmed, not proof none exist. Fallback: ${STATE_APPRENTICESHIP_OFFICE}.`);
  }
  notes.push(...licensure.notes);

  const { claims, dropped } = supportedClaims(
    [
      ...occupations.map(occupationClaim),
      ...programs.map((p) => programClaim(p, place)),
      ...apprenticeships.map(apprenticeshipClaim),
      ...licensure.claims,
    ],
    today,
  );
  if (dropped > 0) notes.push(`${dropped} record${dropped === 1 ? " was" : "s were"} left out for missing or future-dated provenance.`);

  return { claims, notes };
}

async function resolveLocation(location: string | null, notes: string[]): Promise<{ place: Place | null; county: string | null }> {
  if (!location) return { place: null, county: null };
  const name = location.replace(/,?\s*(WA|Washington)\s*$/i, "").trim();
  if (/\bcounty$/i.test(name)) {
    try {
      return { place: null, county: normalizeCounty(name) };
    } catch {
      notes.push(`"${location}" is not a Washington county.`);
      return { place: null, county: null };
    }
  }
  const place = await findPlace(name);
  if (!place) notes.push(`"${location}" is not in the places table, so results were not filtered by location.`);
  return { place, county: place?.county ?? null };
}

function count(n: number): string {
  return n === 0 ? "0 results (unconfirmed, not proof none exist)" : `${n} result${n === 1 ? "" : "s"}`;
}

function clampRadius(value: number | null): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return DEFAULT_RADIUS_MILES;
  return Math.min(Math.round(value), MAX_RADIUS_MILES);
}

function attribution(row: SourceColumns): SourceAttribution {
  return {
    name: row.source_name,
    observationPeriod: row.observation_period,
    asOf: row.source_as_of,
    verificationAuthority: row.verification_authority,
    url: row.source_url,
  };
}

const hourly = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function occupationClaim(o: Occupation): SourcedClaim {
  return {
    id: `occupation:${o.onet_soc_code}`,
    kind: "occupation",
    statement: `O*NET-SOC ${o.onet_soc_code}: ${o.title}.`,
    source: attribution(o),
  };
}

function programClaim(p: TrainingProgramMatch, origin: Place | null): SourcedClaim {
  const address = p.street_address
    ? [p.street_address, p.city, [p.state, p.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : null;
  const where = address ?? [p.city, p.county && `${p.county} County`, p.state].filter(Boolean).join(", ");
  const parts = [
    `${p.title}${p.credential_type ? ` (${p.credential_type})` : ""}, offered by ${p.provider_name} ${address ? "at" : "in"} ${where}.`,
    p.estimated_cost_usd != null ? `Estimated cost: ${usd.format(Number(p.estimated_cost_usd))} (${p.cost_basis}).` : null,
    p.completion_rate != null
      ? `Completion rate: ${Math.round(Number(p.completion_rate) * 100)}%${p.observation_period ? ` (${p.observation_period})` : ""}.`
      : null,
    origin && p.distance_miles != null ? `About ${Math.round(p.distance_miles)} miles from ${origin.name}.` : null,
  ];
  return {
    id: `program:${p.id}`,
    kind: "program",
    statement: parts.filter(Boolean).join(" "),
    source: attribution(p),
    ...(address && {
      place: { name: p.provider_name, address, latitude: p.latitude, longitude: p.longitude },
    }),
  };
}

function apprenticeshipClaim(a: Apprenticeship): SourcedClaim {
  const counties =
    a.counties.length >= 39
      ? "statewide"
      : a.counties.length > 4
        ? `${a.counties.slice(0, 4).join(", ")} and ${a.counties.length - 4} more counties`
        : `${a.counties.join(", ")} ${a.counties.length === 1 ? "County" : "counties"}`;
  const contact = [a.contact_name, a.contact_phone, a.contact_email, a.contact_url].filter(Boolean).join(", ");
  const parts = [
    `${a.trade} registered apprenticeship, sponsored by ${a.sponsor}, serving ${counties}.`,
    a.term_hours ? `Term: ${a.term_hours.toLocaleString("en-US")} hours.` : null,
    a.starting_wage_hourly != null ? `Starting apprentice wage: ${hourly.format(Number(a.starting_wage_hourly))} per hour.` : null,
    a.journey_wage_hourly != null ? `Journey-level wage: ${hourly.format(Number(a.journey_wage_hourly))} per hour.` : null,
    a.requirements ? `Requirements: ${a.requirements.replace(/\.$/, "")}.` : null,
    contact ? `Contact: ${contact}.` : null,
  ];
  return {
    id: `apprenticeship:${a.id}`,
    kind: "apprenticeship",
    statement: parts.filter(Boolean).join(" "),
    source: attribution(a),
  };
}
