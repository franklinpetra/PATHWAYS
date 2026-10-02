// Mirrors the enums and tables in supabase/migrations/20261001000000_phase1_core_schema.sql.
// Once a Supabase project is linked, prefer `supabase gen types typescript` output.

export const READINESS_STATES = ["exploring", "evaluating", "acting", "returning"] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export const PATHWAY_STATUSES = ["exploratory", "active", "paused", "completed", "abandoned", "superseded"] as const;
export type PathwayStatus = (typeof PATHWAY_STATUSES)[number];

export const PROVENANCES = ["user_authored", "user_approved", "ai_inferred", "source_confirmed"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const SEMANTIC_STATUSES = [
  "thought",
  "inference",
  "possibility",
  "confirmed_context",
  "saved_interest",
  "confirmed_goal",
] as const;
export type SemanticStatus = (typeof SEMANTIC_STATUSES)[number];

export const TEMPORAL_STATUSES = ["current", "stale", "superseded", "archived"] as const;
export type TemporalStatus = (typeof TEMPORAL_STATUSES)[number];

export const ACTION_STATUSES = [
  "suggested",
  "user_selected",
  "user_reported_complete",
  "externally_verified",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ACTORS = ["system", "user"] as const;
export type Actor = (typeof ACTORS)[number];

/** Kinds of context the Memory Agent may record. */
export const CONTEXT_ITEM_TYPES = [
  "goal",
  "interest",
  "constraint",
  "preference",
  "circumstance",
  "experience",
  "strength",
  "concern",
  "question",
] as const;
export type ContextItemType = (typeof CONTEXT_ITEM_TYPES)[number];

/**
 * Progress event types that count as a Recent Win. Each is a meaningful step on a
 * pathway; activity signals (logins, sessions, message counts) are deliberately absent.
 */
export const WIN_EVENT_TYPES = [
  "action_completed",
  "application_submitted",
  "conversation_held",
  "program_contacted",
  "event_attended",
  "document_prepared",
  "research_completed",
  "decision_made",
] as const;
export type WinEventType = (typeof WIN_EVENT_TYPES)[number];

export const EVIDENCE_STATUSES = ["user_reported", "advisor_confirmed", "system_verified"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export interface User {
  id: string;
  access_code_hash: string;
  username: string;
  email: string | null;
  created_at: string;
}

export interface Pathway {
  id: string;
  user_id: string;
  title: string;
  canonical_destination_id: string | null;
  destination_type: string | null;
  readiness_state: ReadinessState;
  status: PathwayStatus;
  current_question: string | null;
  why_considered: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContextItem {
  id: string;
  user_id: string;
  type: string;
  user_language: string | null;
  display_text: string;
  provenance: Provenance;
  semantic_status: SemanticStatus;
  temporal_status: TemporalStatus;
  confidence: number | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Action {
  id: string;
  pathway_id: string;
  title: string;
  why: string | null;
  how: string | null;
  due_at: string | null;
  status: ActionStatus;
  display_order: number;
  created_by: Actor;
  /** Hidden from Next Steps until this time ("Not now"). */
  postponed_until: string | null;
  /** Removed by the person; kept so it is not suggested again. */
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgressEvent {
  id: string;
  user_id: string;
  pathway_id: string | null;
  event_type: string;
  title: string;
  evidence_status: EvidenceStatus;
  source: string | null;
  learning: string | null;
  occurred_at: string;
  created_at: string;
}

export interface Occupation {
  onet_soc_code: string;
  title: string;
  description: string | null;
  source_authority: string;
  source_url: string;
  source_as_of: string;
}

export interface Place {
  id: string;
  name: string;
  county: string | null;
  state: string;
  latitude: number;
  longitude: number;
}

/** Row shape returned by the search_programs() SQL function. */
export interface ProgramMatch {
  id: string;
  title: string;
  provider_name: string;
  credential_type: string | null;
  street_address: string | null;
  city: string | null;
  county: string | null;
  state: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  source_authority: string;
  source_url: string;
  source_as_of: string;
  distance_miles: number | null;
}
