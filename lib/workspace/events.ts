import type { Action, ProgressEvent } from "@/lib/db/types";
import type { WinCandidate } from "@/lib/validation/state-guard";

/** A location backed by an authoritative source, cited in an assistant reply. */
export interface VerifiedPlace {
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  authority: string;
  asOf: string;
  sourceUrl: string;
}

/** One line of the /api/chat NDJSON stream. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "places"; items: VerifiedPlace[] }
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
