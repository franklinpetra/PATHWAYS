import type { SteppingStone } from "@/lib/db/types";
import type { SourceAttribution } from "@/lib/workspace/events";

/**
 * Stepping stones: pre-apprenticeships, returnships, transitional employment, and paid-to-learn
 * programs that lead into formal careers. Matching is deterministic: a program qualifies by the
 * career fields of the occupations being discussed or by who the person says they are, and ranks
 * higher for serving that audience, matching the field, and being in their county.
 */

export const AUDIENCES = [
  "women",
  "youth",
  "young_adults",
  "veterans",
  "returning_citizens",
  "returning_parents",
  "experiencing_homelessness",
  "tanf_recipients",
  "tribal_members",
] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Career fields for an O*NET-SOC major group. */
const FIELDS_BY_SOC_GROUP: Record<string, string[]> = {
  "11": [],
  "15": ["technology"],
  "17": ["energy", "technology"],
  "29": ["healthcare"],
  "31": ["healthcare"],
  "35": ["culinary"],
  "47": ["construction"],
  "49": ["construction", "energy", "manufacturing"],
  "51": ["manufacturing"],
  "53": ["maritime"],
};

export function fieldsForSocCodes(socCodes: string[]): string[] {
  return [...new Set(socCodes.flatMap((c) => FIELDS_BY_SOC_GROUP[c.slice(0, 2)] ?? []))];
}

const KIND_LABEL: Record<SteppingStone["kind"], string> = {
  pre_apprenticeship: "pre-apprenticeship",
  returnship: "returnship",
  transitional_employment: "transitional employment program",
  paid_training: "paid training program",
  job_training: "job training program",
  support_service: "support service",
  second_chance_employer: "second-chance employer",
};

/** Services and employers help alongside a route; they never stand in for a training program. */
export const isSupport = (p: SteppingStone) => p.kind === "support_service" || p.kind === "second_chance_employer";

/** Beyond this, a program in another part of the state isn't a realistic option. */
export const MAX_DISTANCE_MILES = 80;

function milesBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export function matchSteppingStones(
  programs: SteppingStone[],
  want: {
    fields: string[];
    audiences: string[];
    county: string | null;
    origin?: { latitude: number; longitude: number } | null;
  },
  limit = 4,
): SteppingStone[] {
  const fields = new Set(want.fields);
  const audiences = new Set(want.audiences);
  return programs
    .map((p) => {
      const audience = p.audiences.some((a) => audiences.has(a));
      const field = p.fields.some((f) => fields.has(f));
      // Programs for a specific audience only surface for people who said they're in it.
      const restricted = p.audiences.length > 0 && !audience;
      const miles =
        want.origin && p.latitude != null && p.longitude != null
          ? milesBetween(want.origin, { latitude: p.latitude, longitude: p.longitude })
          : null;
      const sameCounty = !!want.county && p.county === want.county;
      const tooFar = !p.statewide && miles !== null && miles > MAX_DISTANCE_MILES;
      const nearby = sameCounty || (miles !== null && miles <= 25) ? 3 : miles !== null && miles <= 50 ? 2 : miles !== null ? 1 : 0;
      const score = (audience ? 4 : 0) + (field ? 2 : 0) + nearby + (p.statewide ? 1 : 0);
      return { p, score, eligible: (audience || field) && !restricted && !tooFar };
    })
    .filter((m) => m.eligible)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((m) => m.p);
}

export interface SteppingStoneClaim {
  id: string;
  kind: "stepping_stone";
  statement: string;
  source: SourceAttribution;
}

export function steppingStoneClaim(p: SteppingStone): SteppingStoneClaim {
  const where = p.statewide ? "statewide" : [p.city, p.county && `${p.county} County`].filter(Boolean).join(", ");
  const what =
    p.provenance === "official" && p.kind === "pre_apprenticeship"
      ? `recognized by Washington L&I as an apprenticeship preparation program (a pre-apprenticeship with formal agreements with registered apprenticeship sponsors)`
      : `a ${KIND_LABEL[p.kind]}${p.paid === true ? " that pays participants" : ""}`;
  const contact = [p.contact_name, p.contact_phone, p.contact_email, p.website].filter(Boolean).join(", ");
  const parts = [
    `${p.name}${where ? ` (${where})` : ""}: ${what}.`,
    p.summary ? `${p.provenance === "program" ? "Its own website describes it as: " : ""}${p.summary.replace(/\.$/, "")}.` : null,
    contact ? `Contact: ${contact}.` : null,
  ];
  return {
    id: `stepping_stone:${p.id}`,
    kind: "stepping_stone",
    statement: parts.filter(Boolean).join(" "),
    source: {
      name: p.source_name,
      observationPeriod: p.observation_period,
      asOf: p.source_as_of,
      verificationAuthority: p.verification_authority,
      url: p.source_url,
    },
  };
}
