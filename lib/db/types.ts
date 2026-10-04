import type { SourceAttribution } from "@/lib/workspace/events";
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

export const MESSAGE_ROLES = ["user", "assistant"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_STATUSES = ["complete", "interrupted"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

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

/** One stop on a person's route. Pay is shown only when a verified source stated it. */
export interface RouteStop {
  label: string;
  pay: string | null;
  paySource: SourceAttribution | null;
  /** The main requirement to reach this stop from the previous one, e.g. "Exam". */
  gate: string | null;
}

export interface PathwayRoute {
  pathway_id: string;
  confirmed_stops: RouteStop[] | null;
  suggested_stops: RouteStop[] | null;
  position: number;
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

/** Uniform attribution carried by every row in a source table. */
export interface SourceColumns {
  source_name: string;
  source_url: string;
  observation_period: string | null;
  source_as_of: string;
  verification_authority: string;
}

export interface Occupation extends SourceColumns {
  onet_soc_code: string;
  title: string;
  description: string | null;
}

export interface OccupationWage extends SourceColumns {
  id: string;
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

export interface SteppingStone extends SourceColumns {
  id: string;
  source_record_id: string;
  kind: "pre_apprenticeship" | "returnship" | "transitional_employment" | "paid_training" | "job_training" | "support_service" | "second_chance_employer";
  name: string;
  organization: string | null;
  summary: string | null;
  audiences: string[];
  fields: string[];
  paid: boolean | null;
  open_enrollment: boolean;
  street_address: string | null;
  city: string | null;
  county: string | null;
  state: string;
  postal_code: string | null;
  statewide: boolean;
  latitude: number | null;
  longitude: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
  provenance: "official" | "program";
}

export interface Place {
  id: string;
  name: string;
  county: string | null;
  state: string;
  latitude: number;
  longitude: number;
}

/** Row shape returned by the search_training_programs() SQL function. */
export interface TrainingProgramMatch extends SourceColumns {
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
  /** Published estimate in USD; cost_basis says what it covers. */
  estimated_cost_usd: number | null;
  cost_basis: string | null;
  /** 0..1 for the observation period. */
  completion_rate: number | null;
  distance_miles: number | null;
}

/** A registered apprenticeship from Washington L&I ARTS. */
export interface Apprenticeship extends SourceColumns {
  id: string;
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
  starting_wage_hourly: number | null;
  journey_wage_hourly: number | null;
}

export interface StoredMessage {
  id: string;
  user_id: string;
  pathway_id: string | null;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  /** VerifiedPlace[] for assistant replies. */
  places: unknown[];
  /** Citation[] for assistant replies: the sourced claims the reply cited. */
  citations: unknown[];
  /** Figures in an assistant reply that matched no verified source. */
  unverified_figures: string[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// Licensure (see supabase/migrations/20261006000000_licensure.sql)
// ---------------------------------------------------------------------------

export const AUTHORITY_ROLES = ["governing", "discovery"] as const;
export type AuthorityRole = (typeof AUTHORITY_ROLES)[number];

export const CREDENTIAL_KINDS = ["license", "certification", "registration", "permit", "endorsement"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const FEE_TYPES = [
  "application",
  "exam",
  "background_check",
  "fingerprinting",
  "initial_license",
  "renewal",
  "late_renewal",
  "credential_evaluation",
  "other",
] as const;
export type FeeType = (typeof FEE_TYPES)[number];

export const AMOUNT_STATUSES = ["known", "zero", "unknown", "variable", "not_applicable"] as const;
export type AmountStatus = (typeof AMOUNT_STATUSES)[number];

export interface SourcedRecord {
  source_name: string;
  source_url: string;
  observation_period: string | null;
  source_as_of: string;
  source_authority: { name: string; role: AuthorityRole };
}

export interface CredentialVersionRecord extends SourcedRecord {
  id: string;
  effective_from: string;
  effective_to: string | null;
  requirements: string | null;
  duration_note: string | null;
}

export interface CredentialFeeRecord extends SourcedRecord {
  fee_type: FeeType;
  label: string | null;
  amount_status: AmountStatus;
  amount: number | null;
  currency: string | null;
  recurrence_months: number | null;
  notes: string | null;
}

/** Row shape returned by the search_credentials() SQL function. */
export interface CredentialMatch {
  credential_id: string;
  credential_name: string;
  credential_kind: CredentialKind;
  jurisdiction_code: string;
  jurisdiction_name: string;
  version: CredentialVersionRecord;
  fees: CredentialFeeRecord[];
  authorities: { name: string; role: AuthorityRole; relationship: "issuer" | "exam_administrator" | "listed_by"; website_url: string | null }[];
}
