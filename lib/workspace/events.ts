import type { Action, ProgressEvent } from "@/lib/db/types";
import type { WinCandidate } from "@/lib/validation/state-guard";

/** Where a claim comes from: [Source Name | Observation Period / As-of Date | Verification Authority]. */
export interface SourceAttribution {
  name: string;
  observationPeriod: string | null;
  /** ISO date the data was current. */
  asOf: string;
  verificationAuthority: string;
  url: string;
}

/** A sourced claim an assistant reply cited as [index]. */
export interface Citation {
  index: number;
  kind: "occupation" | "program" | "apprenticeship" | "licensure" | "official";
  statement: string;
  source: SourceAttribution;
}

/** A location backed by an authoritative source, cited in an assistant reply. */
export interface VerifiedPlace {
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  source: SourceAttribution;
}

/** One line of the /api/chat NDJSON stream. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "citations"; items: Citation[] }
  | { type: "places"; items: VerifiedPlace[] }
  /** Money or percentage figures in the reply that matched no verified source or the person's own words. */
  | { type: "grounding"; unverifiedFigures: string[] }
  | { type: "topics"; items: string[] }
  | { type: "next_steps"; items: Action[] }
  | { type: "wins"; recent: ProgressEvent[]; candidates: WinCandidate[] }
  | { type: "error"; message: string }
  | { type: "done" };

/** Response body of /api/workspace/actions. */
export interface PanelsResponse {
  nextSteps: Action[];
  recentWins: ProgressEvent[];
  /** How many requested changes the state guard declined. */
  rejected: number;
}
