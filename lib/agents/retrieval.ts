import "server-only";
import { z } from "zod";
import { generateStructured } from "@/lib/ai/openrouter";
import { findOccupations, findPlace, searchPrograms } from "@/lib/db/queries";
import type { ContextItem, Occupation, Place, ProgramMatch } from "@/lib/db/types";

/**
 * Fact-Finder Agent.
 *
 * The model's only job here is to extract search parameters. Every claim is then
 * assembled deterministically from rows in the authoritative source tables, each
 * carrying its named authority, URL, and as-of date. If the tables have nothing,
 * the agent says so; it never fills gaps.
 */

const DEFAULT_RADIUS_MILES = 25;
const MAX_RADIUS_MILES = 100;

const lookupParamsSchema = z.object({
  needs_lookup: z
    .boolean()
    .describe("True only if answering well requires programs or occupation data for a specific occupation."),
  occupation: z.string().nullable().describe("Occupation or field in plain words, e.g. 'registered nurse'."),
  location: z.string().nullable().describe("City or county name only, e.g. 'Tacoma'. Null if not stated."),
  radius_miles: z.number().nullable().describe("Only if the person stated a distance."),
});

export type LookupParams = z.infer<typeof lookupParamsSchema>;

const SYSTEM_PROMPT = `Extract search parameters from a person's message about education or career pathways in Washington State.
Use their known context for a location if the message does not name one.
Only extract what is stated or recorded. Never guess an occupation or location.`;

export interface SourcedClaim {
  /** Stable reference, e.g. "program:<uuid>" or "occupation:29-1141.00". */
  id: string;
  kind: "occupation" | "program";
  statement: string;
  authority: string;
  sourceUrl: string;
  /** ISO date the source data was current. */
  asOf: string;
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

  if (!params.needs_lookup || !params.occupation?.trim()) return { params, claims: [], notes: [] };

  const occupations = await findOccupations(params.occupation);
  if (occupations.length === 0) {
    return {
      params,
      claims: [],
      notes: [`No occupation in the O*NET table matched "${params.occupation}".`],
    };
  }

  const place = params.location ? await findPlace(stripState(params.location)) : null;
  const radius = place ? clampRadius(params.radius_miles) : null;
  const programs = await searchPrograms({
    socCodes: occupations.map((o) => o.onet_soc_code),
    latitude: place?.latitude ?? null,
    longitude: place?.longitude ?? null,
    radiusMiles: radius,
  });

  const occupationNames = occupations.map((o) => o.title).join(", ");
  const notes = [
    params.location && !place
      ? `"${params.location}" is not in the places table, so programs were not filtered by distance.`
      : null,
    `Program search for ${occupationNames}${place ? ` within ${radius} miles of ${place.name}, ${place.state}` : ""}: ${programs.length} result${programs.length === 1 ? "" : "s"}.`,
  ].filter((n): n is string => n !== null);

  return {
    params,
    claims: [...occupations.map(occupationClaim), ...programs.map((p) => programClaim(p, place))],
    notes,
  };
}

function stripState(location: string): string {
  return location.replace(/,?\s*(WA|Washington)\s*$/i, "").trim();
}

function clampRadius(value: number | null): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return DEFAULT_RADIUS_MILES;
  return Math.min(Math.round(value), MAX_RADIUS_MILES);
}

function occupationClaim(o: Occupation): SourcedClaim {
  return {
    id: `occupation:${o.onet_soc_code}`,
    kind: "occupation",
    statement: `O*NET-SOC ${o.onet_soc_code}: ${o.title}.`,
    authority: o.source_authority,
    sourceUrl: o.source_url,
    asOf: o.source_as_of,
  };
}

function programClaim(p: ProgramMatch, origin: Place | null): SourcedClaim {
  const address = p.street_address
    ? [p.street_address, p.city, [p.state, p.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : null;
  const where = address ?? [p.city, p.county && `${p.county} County`, p.state].filter(Boolean).join(", ");
  const distance =
    origin && p.distance_miles != null ? ` About ${Math.round(p.distance_miles)} miles from ${origin.name}.` : "";
  return {
    id: `program:${p.id}`,
    kind: "program",
    statement: `${p.title}${p.credential_type ? ` (${p.credential_type})` : ""}, offered by ${p.provider_name} ${address ? "at" : "in"} ${where}.${distance}`,
    authority: p.source_authority,
    sourceUrl: p.source_url,
    asOf: p.source_as_of,
    ...(address && {
      place: { name: p.provider_name, address, latitude: p.latitude, longitude: p.longitude },
    }),
  };
}
