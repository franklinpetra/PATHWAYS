import { z } from "zod";
import { extractFigures } from "@/lib/agents/grounding";
import type { SourceAttribution } from "@/lib/workspace/events";
import {
  CONTEXT_ITEM_TYPES,
  WIN_EVENT_TYPES,
  type Action,
  type ActionStatus,
  type Actor,
  type ContextItem,
  type EvidenceStatus,
  type MessageRole,
  type MessageStatus,
  type Pathway,
  type PathwayRoute,
  type ProgressEvent,
  type RouteStop,
  type Provenance,
  type StoredMessage,
  type SemanticStatus,
  type TemporalStatus,
} from "@/lib/db/types";

/**
 * Deterministic State Validator.
 *
 * Agents only ever produce *proposals*. This module is the single place that turns
 * proposals and explicit user actions into `ValidatedMutation`s, the only input
 * lib/db/mutations.ts accepts. The brand below cannot be constructed elsewhere
 * without a deliberate cast, so model output has no path to the database that
 * skips these rules:
 *
 *  - AI inferences stay provisional (thought / inference / possibility).
 *  - saved_interest and confirmed_goal are reachable only through explicit user actions.
 *  - AI-drafted Next Steps are created as 'suggested' and only the user can adopt or complete them.
 *    Ordering, "Not now", removal, and due dates are the person's alone; the AI never sets a date.
 *  - Recent Wins must be meaningful pathway actions, never logins, sessions, or chat counts.
 *  - A current user statement silently supersedes the stale context it contradicts.
 *  - The person can keep, rewrite, or delete anything remembered. Deleted items are archived,
 *    leave every prompt, and are not re-inferred unless the person says them again.
 *  - The AI may only suggest a route. Using it and moving "you are here" are the person's
 *    actions, and a stop shows pay only when a verified source from that turn states it.
 */

// ---------------------------------------------------------------------------
// Validated mutations
// ---------------------------------------------------------------------------

declare const validated: unique symbol;

type ContextItemInsert = Pick<
  ContextItem,
  "id" | "user_id" | "type" | "user_language" | "display_text" | "provenance" | "semantic_status" | "temporal_status" | "confidence"
>;
type ContextItemPatch = Partial<Pick<ContextItem, "semantic_status" | "provenance" | "temporal_status" | "superseded_by">>;
type ActionInsert = Pick<Action, "pathway_id" | "title" | "why" | "how" | "status" | "display_order" | "created_by">;
type ActionFieldPatch = Partial<Pick<Action, "display_order" | "postponed_until" | "removed_at" | "due_at">>;
type ProgressEventInsert = Pick<
  ProgressEvent,
  "user_id" | "pathway_id" | "event_type" | "title" | "evidence_status" | "source" | "learning"
>;

type MessageInsert = Pick<
  StoredMessage,
  "user_id" | "pathway_id" | "role" | "content" | "status" | "places" | "citations" | "unverified_figures" | "spoken" | "via_voice"
>;

type Mutation =
  | { op: "insert_context_item"; row: ContextItemInsert }
  | { op: "update_context_item"; id: string; userId: string; patch: ContextItemPatch }
  | { op: "insert_action"; row: ActionInsert }
  | { op: "update_action_status"; id: string; from: ActionStatus; status: ActionStatus }
  | { op: "update_action_fields"; id: string; patch: ActionFieldPatch }
  | { op: "insert_progress_event"; row: ProgressEventInsert }
  | { op: "update_progress_event"; id: string; userId: string; patch: { title: string; learning: string | null } }
  | { op: "insert_message"; row: MessageInsert }
  | { op: "upsert_route"; pathwayId: string; patch: Partial<Pick<PathwayRoute, "confirmed_stops" | "suggested_stops" | "position">> };

export type ValidatedMutation = Mutation & { readonly [validated]: true };

function seal(m: Mutation): ValidatedMutation {
  return m as ValidatedMutation;
}

export interface Rejection {
  proposal: string;
  reason: string;
}

export interface GuardResult {
  mutations: ValidatedMutation[];
  rejections: Rejection[];
}

/** Everything the guard needs to know about a person's current state. */
export interface GuardState {
  userId: string;
  /** Current and stale items. */
  contextItems: ContextItem[];
  /** Items the person deleted. Used only to keep the AI from re-inferring them. */
  archivedContextItems: ContextItem[];
  pathways: Pathway[];
  /** All actions on the person's pathways, including removed ones. */
  actions: Action[];
  /** The person's recent progress events (the ones they can see and edit). */
  progressEvents: ProgressEvent[];
  /** Routes on the person's pathways. */
  routes?: PathwayRoute[];
}

// ---------------------------------------------------------------------------
// Transition tables
// ---------------------------------------------------------------------------

/** Semantic states an AI-inferred item may hold. Mirrors the DB check constraint. */
const PROVISIONAL: readonly SemanticStatus[] = ["thought", "inference", "possibility"];

/** Semantic states a user's own statement may create without a further explicit action. */
const USER_STATEMENT: readonly SemanticStatus[] = ["thought", "possibility", "confirmed_context"];

/** States that reflect a decision the person made; the AI may not demote them. */
const USER_DECISIONS: readonly SemanticStatus[] = ["saved_interest", "confirmed_goal"];

const TEMPORAL_TRANSITIONS: Record<TemporalStatus, readonly TemporalStatus[]> = {
  current: ["stale", "superseded", "archived"],
  stale: ["current", "superseded", "archived"],
  superseded: ["archived"],
  archived: [],
};

/** Action status changes and who may make them. Nothing here is reachable by the AI. */
const ACTION_TRANSITIONS: Record<"adopt_step" | "complete_step", { from: readonly ActionStatus[]; to: ActionStatus }> = {
  adopt_step: { from: ["suggested"], to: "user_selected" },
  complete_step: { from: ["suggested", "user_selected"], to: "user_reported_complete" },
};

export function canTransitionTemporal(from: TemporalStatus, to: TemporalStatus): boolean {
  return TEMPORAL_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

const LIMITS = { displayText: 280, title: 120, detail: 600, userLanguage: 1000 } as const;
const MAX_SUGGESTED_STEPS_PER_TURN = 3;
/** Next Steps stays right-sized: the AI only suggests until this many steps are visible. */
export const MAX_VISIBLE_STEPS = 3;
const POSTPONE_DAYS = 7;

function isOpen(a: Action): boolean {
  return (a.status === "suggested" || a.status === "user_selected") && a.removed_at === null;
}

/** Open and not postponed past `now`: what the Next Steps card shows. */
export function isVisibleStep(a: Action, now: Date): boolean {
  return isOpen(a) && (a.postponed_until === null || new Date(a.postponed_until) <= now);
}

function cleanText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? null : text;
}

function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A quote is user-authored only if it appears verbatim in what the person just said. */
function isVerbatimQuote(quote: string | null, userMessage: string): boolean {
  if (!quote) return false;
  const q = normalizeForMatch(quote);
  return q.length >= 3 && normalizeForMatch(userMessage).includes(q);
}

function clampConfidence(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

/**
 * Platitudes the AI may not draft as Next Steps. Resume steps pass only when tied to a
 * target ("... resume for the Kroger pharmacy technician role").
 */
const GENERIC_STEP =
  /\b(reach(ing)? out to (your |my )?(network|contacts)|grow (your |my )?network|network(ing)?( more| events?)?$|check (online )?job (boards|sites|listings)|browse job (boards|listings)|search (for )?jobs online|(update|tailor|polish|refresh|improve) (your |my )?(resume|cv|linkedin)(?! (for|to target|to match) ))/i;

export function isGenericStep(title: string): boolean {
  return GENERIC_STEP.test(title.trim());
}

const ACTIVITY_SIGNAL =
  /\b(log(ged)?[\s-]?in|sign(ed)?[\s-]?in|streak|opened (the )?app|visited (the )?app|came back|returned to (the )?app|\d+\s+(messages?|chats?|sessions?|visits?)|messages? sent|chat count)\b/i;

function checkWinTitle(title: string | null): string | null {
  if (!title) return "title is empty or too long";
  if (ACTIVITY_SIGNAL.test(title)) return "logins, sessions, and chat activity are not wins";
  return null;
}

/** Wins must be meaningful pathway actions, not engagement signals. */
function checkMeaningfulWin(state: GuardState, eventType: string, title: string | null, pathwayId: string | null): string | null {
  if (!(WIN_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return `event_type '${eventType}' is not a meaningful pathway action`;
  }
  const titleError = checkWinTitle(title);
  if (titleError) return titleError;
  if (!pathwayId) return "a win must belong to a pathway";
  if (!ownsPathway(state, pathwayId)) return "pathway not found";
  return null;
}

function ownsPathway(state: GuardState, pathwayId: string): boolean {
  return state.pathways.some((p) => p.id === pathwayId);
}

// ---------------------------------------------------------------------------
// Memory Agent proposals
// ---------------------------------------------------------------------------

export interface ContextCreateProposal {
  type: string;
  user_language: string | null;
  display_text: string;
  /** Claimed provenance; verified against the user's message. */
  provenance: Provenance;
  semantic_status: SemanticStatus;
  confidence: number | null;
  /** Ids of existing items this statement replaces. */
  supersedes: string[];
}

export interface ContextStaleProposal {
  id: string;
  reason: string;
}

export function guardMemoryProposals(
  state: GuardState,
  userMessage: string,
  proposals: { creates: ContextCreateProposal[]; stale: ContextStaleProposal[] },
  newId: () => string = () => crypto.randomUUID(),
): GuardResult {
  const result: GuardResult = { mutations: [], rejections: [] };
  const byId = new Map(state.contextItems.map((item) => [item.id, item]));
  const touched = new Set<string>();
  const existingText = new Set(
    state.contextItems.filter((i) => i.temporal_status === "current").map((i) => normalizeForMatch(i.display_text)),
  );
  const deletedText = new Set(state.archivedContextItems.map((i) => normalizeForMatch(i.display_text)));

  for (const p of proposals.creates) {
    const label = `create context "${p.display_text}"`;
    const reject = (reason: string) => result.rejections.push({ proposal: label, reason });

    if (!(CONTEXT_ITEM_TYPES as readonly string[]).includes(p.type)) {
      reject(`unknown type '${p.type}'`);
      continue;
    }
    const displayText = cleanText(p.display_text, LIMITS.displayText);
    if (!displayText) {
      reject("display_text is empty or too long");
      continue;
    }
    if (existingText.has(normalizeForMatch(displayText))) {
      reject("duplicates a current item");
      continue;
    }

    // Provenance is earned, not claimed: 'user_authored' requires a verbatim quote.
    const userLanguage = cleanText(p.user_language, LIMITS.userLanguage);
    let provenance: Provenance;
    if (p.provenance === "user_authored") {
      provenance = isVerbatimQuote(userLanguage, userMessage) ? "user_authored" : "ai_inferred";
    } else if (p.provenance === "ai_inferred") {
      provenance = "ai_inferred";
    } else {
      reject(`provenance '${p.provenance}' requires user approval or a source`);
      continue;
    }

    if (provenance === "ai_inferred" && deletedText.has(normalizeForMatch(displayText))) {
      reject("the person deleted this; only they can bring it back");
      continue;
    }

    const allowed = provenance === "user_authored" ? USER_STATEMENT : PROVISIONAL;
    if (!allowed.includes(p.semantic_status)) {
      reject(
        USER_DECISIONS.includes(p.semantic_status)
          ? `'${p.semantic_status}' requires an explicit user action`
          : `${provenance} items cannot be '${p.semantic_status}'`,
      );
      continue;
    }

    // Supersession: a user's own statement may replace anything; an inference may only replace inferences.
    const targets: ContextItem[] = [];
    let supersedeError: string | null = null;
    for (const targetId of new Set(p.supersedes)) {
      const target = byId.get(targetId);
      if (!target) supersedeError = `superseded item ${targetId} not found`;
      else if (touched.has(targetId)) supersedeError = `item ${targetId} already changed this turn`;
      else if (provenance === "ai_inferred" && target.provenance !== "ai_inferred")
        supersedeError = "an inference cannot supersede the person's own context";
      else targets.push(target);
      if (supersedeError) break;
    }
    if (supersedeError) {
      reject(supersedeError);
      continue;
    }

    const id = newId();
    result.mutations.push(
      seal({
        op: "insert_context_item",
        row: {
          id,
          user_id: state.userId,
          type: p.type,
          user_language: provenance === "user_authored" ? userLanguage : null,
          display_text: displayText,
          provenance,
          semantic_status: p.semantic_status,
          temporal_status: "current",
          confidence: provenance === "user_authored" ? null : clampConfidence(p.confidence),
        },
      }),
    );
    for (const target of targets) {
      touched.add(target.id);
      result.mutations.push(
        seal({
          op: "update_context_item",
          id: target.id,
          userId: state.userId,
          patch: { temporal_status: "superseded", superseded_by: id },
        }),
      );
    }
    existingText.add(normalizeForMatch(displayText));
  }

  for (const p of proposals.stale) {
    const label = `mark stale ${p.id}`;
    const target = byId.get(p.id);
    if (!target) {
      result.rejections.push({ proposal: label, reason: "item not found" });
    } else if (touched.has(p.id)) {
      result.rejections.push({ proposal: label, reason: "item already changed this turn" });
    } else if (USER_DECISIONS.includes(target.semantic_status)) {
      result.rejections.push({ proposal: label, reason: "the person's saved interests and goals change only by their action" });
    } else if (!canTransitionTemporal(target.temporal_status, "stale")) {
      result.rejections.push({ proposal: label, reason: `cannot move from '${target.temporal_status}' to 'stale'` });
    } else {
      touched.add(p.id);
      result.mutations.push(
        seal({ op: "update_context_item", id: p.id, userId: state.userId, patch: { temporal_status: "stale" } }),
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// AI-drafted Next Steps
// ---------------------------------------------------------------------------

export interface StepProposal {
  pathway_id: string;
  title: string;
  why: string | null;
  how: string | null;
  /** If a proposal tries to set any status other than 'suggested', it is rejected. */
  status?: ActionStatus;
  created_by?: Actor;
}

export function guardStepProposals(state: GuardState, proposals: StepProposal[], now = new Date()): GuardResult {
  const result: GuardResult = { mutations: [], rejections: [] };
  // Includes completed and removed steps: the AI should not re-suggest what the person already did or declined.
  const knownTitles = new Set(state.actions.map((a) => `${a.pathway_id}:${normalizeForMatch(a.title)}`));
  const visibleCount = new Map<string, number>();
  for (const a of state.actions) {
    if (isVisibleStep(a, now)) visibleCount.set(a.pathway_id, (visibleCount.get(a.pathway_id) ?? 0) + 1);
  }
  const nextOrder = new Map<string, number>();

  for (const p of proposals) {
    const label = `suggest step "${p.title}"`;
    const reject = (reason: string) => result.rejections.push({ proposal: label, reason });

    if (result.mutations.length >= MAX_SUGGESTED_STEPS_PER_TURN) {
      reject(`at most ${MAX_SUGGESTED_STEPS_PER_TURN} suggestions per turn`);
      continue;
    }
    if (p.status !== undefined && p.status !== "suggested") {
      reject("AI-drafted steps stay 'suggested' until the person adopts them");
      continue;
    }
    if (p.created_by !== undefined && p.created_by !== "system") {
      reject("AI-drafted steps are created by 'system'");
      continue;
    }
    if (!ownsPathway(state, p.pathway_id)) {
      reject("pathway not found");
      continue;
    }
    const title = cleanText(p.title, LIMITS.title);
    if (!title) {
      reject("title is empty or too long");
      continue;
    }
    const key = `${p.pathway_id}:${normalizeForMatch(title)}`;
    if (isGenericStep(title)) {
      reject("generic advice; a step must name an employer, role, program, credential, registry, office, or form");
      continue;
    }
    if (knownTitles.has(key)) {
      reject("duplicates an existing or removed step");
      continue;
    }
    if ((visibleCount.get(p.pathway_id) ?? 0) >= MAX_VISIBLE_STEPS) {
      reject(`the pathway already shows ${MAX_VISIBLE_STEPS} steps`);
      continue;
    }

    if (!nextOrder.has(p.pathway_id)) {
      const orders = state.actions.filter((a) => a.pathway_id === p.pathway_id).map((a) => a.display_order);
      nextOrder.set(p.pathway_id, orders.length ? Math.max(...orders) + 1 : 0);
    }
    const order = nextOrder.get(p.pathway_id)!;
    nextOrder.set(p.pathway_id, order + 1);
    knownTitles.add(key);
    visibleCount.set(p.pathway_id, (visibleCount.get(p.pathway_id) ?? 0) + 1);

    result.mutations.push(
      seal({
        op: "insert_action",
        row: {
          pathway_id: p.pathway_id,
          title,
          why: cleanText(p.why, LIMITS.detail),
          how: cleanText(p.how, LIMITS.detail),
          status: "suggested",
          display_order: order,
          created_by: "system",
        },
      }),
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// AI-suggested routes
// ---------------------------------------------------------------------------

export const ROUTE_LIMITS = { minStops: 2, maxStops: 5, label: 40, gate: 24, pay: 32 } as const;

export interface RouteStopProposal {
  label: string;
  /** A pay figure as the reply stated it, e.g. "$21.00/hr". */
  pay: string | null;
  /** The [n] of the verified source that states the pay. */
  pay_source_number: number | null;
  gate_before: string | null;
}

/** A sourced claim from this turn, numbered as the reply cited it ([1] is index 0). */
export interface RouteClaim {
  statement: string;
  source: SourceAttribution;
}

function sameStops(a: RouteStop[] | null | undefined, b: RouteStop[]): boolean {
  return !!a && JSON.stringify(a.map((s) => [s.label, s.pay, s.gate])) === JSON.stringify(b.map((s) => [s.label, s.pay, s.gate]));
}

/**
 * Turns an AI route proposal into a suggestion. Labels and gates are cleaned and capped; a
 * stop keeps its pay only if every figure in it appears in the cited verified claim, and then
 * carries that claim's source. The person's confirmed route and position are never touched.
 */
export function guardRouteProposal(
  state: GuardState,
  pathwayId: string,
  proposal: RouteStopProposal[] | null,
  claims: RouteClaim[],
): GuardResult {
  const result: GuardResult = { mutations: [], rejections: [] };
  if (!proposal) return result;
  const reject = (reason: string) => result.rejections.push({ proposal: "suggest route", reason });
  if (!ownsPathway(state, pathwayId)) {
    reject("pathway not found");
    return result;
  }

  const stops: RouteStop[] = [];
  for (const [i, p] of proposal.slice(0, ROUTE_LIMITS.maxStops).entries()) {
    const label = cleanText(p.label, ROUTE_LIMITS.label);
    if (!label) continue;
    const claim = p.pay_source_number != null ? claims[p.pay_source_number - 1] : undefined;
    const pay = cleanText(p.pay, ROUTE_LIMITS.pay);
    const figures = pay ? extractFigures(pay) : [];
    const claimFigures = new Set(claim ? extractFigures(claim.statement).map((f) => f.key) : []);
    const verified = !!claim && figures.length > 0 && figures.every((f) => claimFigures.has(f.key));
    stops.push({
      label,
      pay: verified ? pay : null,
      paySource: verified ? claim!.source : null,
      gate: i === 0 ? null : cleanText(p.gate_before, ROUTE_LIMITS.gate),
    });
  }
  if (stops.length < ROUTE_LIMITS.minStops) {
    reject(`a route needs at least ${ROUTE_LIMITS.minStops} stops`);
    return result;
  }

  const current = state.routes?.find((r) => r.pathway_id === pathwayId);
  if (sameStops(current?.confirmed_stops, stops) || sameStops(current?.suggested_stops, stops)) return result;
  result.mutations.push(seal({ op: "upsert_route", pathwayId, patch: { suggested_stops: stops } }));
  return result;
}

// ---------------------------------------------------------------------------
// AI-proposed Recent Wins (candidates only; never persisted without the person)
// ---------------------------------------------------------------------------

export interface WinProposal {
  pathway_id: string | null;
  event_type: string;
  title: string;
  learning: string | null;
  evidence_status?: EvidenceStatus;
}

export interface WinCandidate {
  pathway_id: string;
  event_type: string;
  title: string;
  learning: string | null;
}

/** Filters AI-proposed wins down to meaningful, well-formed candidates the person can choose to record. */
export function guardWinCandidates(
  state: GuardState,
  proposals: WinProposal[],
): { candidates: WinCandidate[]; rejections: Rejection[] } {
  const candidates: WinCandidate[] = [];
  const rejections: Rejection[] = [];
  for (const p of proposals) {
    const title = cleanText(p.title, LIMITS.title);
    const error =
      p.evidence_status && p.evidence_status !== "user_reported"
        ? "only the person can report a win from conversation"
        : checkMeaningfulWin(state, p.event_type, title, p.pathway_id);
    if (error) rejections.push({ proposal: `win "${p.title}"`, reason: error });
    else
      candidates.push({
        pathway_id: p.pathway_id!,
        event_type: p.event_type,
        title: title!,
        learning: cleanText(p.learning, LIMITS.detail),
      });
  }
  return { candidates, rejections };
}

// ---------------------------------------------------------------------------
// Conversation transcript (append-only)
// ---------------------------------------------------------------------------

const MESSAGE_LIMITS: Record<MessageRole, number> = { user: 4000, assistant: 20000 };

export interface MessageProposal {
  role: MessageRole;
  content: string;
  pathwayId: string | null;
  status?: MessageStatus;
  places?: unknown[];
  citations?: unknown[];
  unverifiedFigures?: string[];
  /** Assistant only: the checked line spoken aloud. */
  spoken?: string | null;
  /** User only: the message was spoken and transcribed. */
  viaVoice?: boolean;
}

/** Records one message. Only assistant replies may be 'interrupted' or carry places and citations. */
export function guardMessage(state: GuardState, p: MessageProposal): GuardResult {
  const reject = (reason: string): GuardResult => ({
    mutations: [],
    rejections: [{ proposal: `${p.role} message`, reason }],
  });
  const content = p.content.trim();
  if (!content) return reject("message is empty");
  if (content.length > MESSAGE_LIMITS[p.role]) return reject("message is too long");
  if (p.pathwayId && !ownsPathway(state, p.pathwayId)) return reject("pathway not found");
  if (
    p.role === "user" &&
    (p.status === "interrupted" ||
      (p.places?.length ?? 0) > 0 ||
      (p.citations?.length ?? 0) > 0 ||
      (p.unverifiedFigures?.length ?? 0) > 0)
  ) {
    return reject("user messages are always complete and carry no places, citations, or grounding flags");
  }
  if (p.role === "user" && p.spoken) return reject("only assistant replies have a spoken line");
  if (p.role === "assistant" && p.viaVoice) return reject("only the person's messages can be spoken by them");
  const spoken = p.spoken?.trim() || null;
  if (spoken && spoken.length > 600) return reject("spoken line is too long");
  return {
    mutations: [
      seal({
        op: "insert_message",
        row: {
          user_id: state.userId,
          pathway_id: p.pathwayId,
          role: p.role,
          content,
          status: p.status ?? "complete",
          places: p.places ?? [],
          citations: p.citations ?? [],
          unverified_figures: p.unverifiedFigures ?? [],
          spoken,
          via_voice: p.viaVoice ?? false,
        },
      }),
    ],
    rejections: [],
  };
}

// ---------------------------------------------------------------------------
// Explicit user actions (UI controls, never model interpretation)
// ---------------------------------------------------------------------------

const saveInterestSchema = z.object({ type: z.literal("save_interest"), contextItemId: z.uuid() });
const confirmGoalSchema = z.object({ type: z.literal("confirm_goal"), contextItemId: z.uuid() });
const keepItemSchema = z.object({ type: z.literal("keep_context_item"), contextItemId: z.uuid() });
const editItemSchema = z.object({ type: z.literal("edit_context_item"), contextItemId: z.uuid(), text: z.string() });
const archiveItemSchema = z.object({ type: z.literal("archive_context_item"), contextItemId: z.uuid() });

/** Controls on the My Story & AI Memory page. */
export const memoryActionSchema = z.discriminatedUnion("type", [
  saveInterestSchema,
  confirmGoalSchema,
  keepItemSchema,
  editItemSchema,
  archiveItemSchema,
]);

export const userActionSchema = z.discriminatedUnion("type", [
  saveInterestSchema,
  confirmGoalSchema,
  keepItemSchema,
  editItemSchema,
  archiveItemSchema,
  z.object({ type: z.literal("adopt_step"), actionId: z.uuid() }),
  z.object({ type: z.literal("complete_step"), actionId: z.uuid() }),
  z.object({ type: z.literal("postpone_step"), actionId: z.uuid() }),
  z.object({ type: z.literal("remove_step"), actionId: z.uuid() }),
  z.object({ type: z.literal("reorder_steps"), pathwayId: z.uuid(), actionIds: z.array(z.uuid()).min(1).max(20) }),
  z.object({ type: z.literal("set_step_due"), actionId: z.uuid(), dueDate: z.iso.date().nullable() }),
  z.object({
    type: z.literal("record_win"),
    win: z.object({
      pathwayId: z.uuid(),
      eventType: z.string(),
      title: z.string(),
      learning: z.string().nullable().optional(),
    }),
  }),
  z.object({ type: z.literal("accept_route"), pathwayId: z.uuid() }),
  z.object({ type: z.literal("dismiss_route"), pathwayId: z.uuid() }),
  z.object({ type: z.literal("set_route_position"), pathwayId: z.uuid(), position: z.number().int().min(0).max(20) }),
  z.object({
    type: z.literal("edit_win"),
    progressEventId: z.uuid(),
    title: z.string(),
    learning: z.string().nullable().optional(),
  }),
]);
export type UserAction = z.infer<typeof userActionSchema>;

/** Semantic states from which the person may save an interest or confirm a goal. */
const SAVE_FROM: readonly SemanticStatus[] = ["thought", "inference", "possibility", "confirmed_context"];
const CONFIRM_GOAL_FROM: readonly SemanticStatus[] = ["possibility", "confirmed_context", "saved_interest"];

export function guardUserActions(state: GuardState, actions: UserAction[], now = new Date()): GuardResult {
  const result: GuardResult = { mutations: [], rejections: [] };
  const actionsById = new Map(state.actions.map((a) => [a.id, { ...a }]));
  const itemsById = new Map(state.contextItems.map((i) => [i.id, { ...i }]));
  const eventsById = new Map(state.progressEvents.map((e) => [e.id, e]));
  const openStep = (id: string) => {
    const step = actionsById.get(id);
    return step && isOpen(step) ? step : null;
  };

  for (const action of actions) {
    const reject = (reason: string) => result.rejections.push({ proposal: action.type, reason });

    switch (action.type) {
      case "adopt_step":
      case "complete_step": {
        const step = actionsById.get(action.actionId);
        const rule = ACTION_TRANSITIONS[action.type];
        if (!step || step.removed_at !== null) {
          reject("step not found");
          break;
        }
        if (!rule.from.includes(step.status)) {
          reject(`cannot move a '${step.status}' step to '${rule.to}'`);
          break;
        }
        result.mutations.push(seal({ op: "update_action_status", id: step.id, from: step.status, status: rule.to }));
        step.status = rule.to;

        if (action.type === "complete_step") {
          result.mutations.push(
            seal({
              op: "insert_progress_event",
              row: {
                user_id: state.userId,
                pathway_id: step.pathway_id,
                event_type: "action_completed",
                title: step.title,
                evidence_status: "user_reported",
                source: "next_step",
                learning: null,
              },
            }),
          );
        }
        break;
      }

      case "postpone_step": {
        const step = openStep(action.actionId);
        if (!step) {
          reject("step not found or no longer open");
          break;
        }
        const until = new Date(now.getTime() + POSTPONE_DAYS * 24 * 60 * 60 * 1000).toISOString();
        result.mutations.push(seal({ op: "update_action_fields", id: step.id, patch: { postponed_until: until } }));
        step.postponed_until = until;
        break;
      }

      case "remove_step": {
        const step = openStep(action.actionId);
        if (!step) {
          reject("step not found or no longer open");
          break;
        }
        const removedAt = now.toISOString();
        result.mutations.push(seal({ op: "update_action_fields", id: step.id, patch: { removed_at: removedAt } }));
        step.removed_at = removedAt;
        break;
      }

      case "reorder_steps": {
        const steps = action.actionIds.map(openStep);
        if (new Set(action.actionIds).size !== action.actionIds.length) {
          reject("duplicate step in order");
        } else if (steps.some((s) => !s || s.pathway_id !== action.pathwayId) || !ownsPathway(state, action.pathwayId)) {
          reject("every step must be open and on the same pathway");
        } else {
          steps.forEach((s, index) => {
            if (s!.display_order === index) return;
            result.mutations.push(seal({ op: "update_action_fields", id: s!.id, patch: { display_order: index } }));
            s!.display_order = index;
          });
        }
        break;
      }

      case "set_step_due": {
        const step = openStep(action.actionId);
        if (!step) {
          reject("step not found or no longer open");
          break;
        }
        // Date-only values; allow "yesterday" in UTC so a person west of UTC can still pick today.
        const earliest = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        if (action.dueDate !== null && action.dueDate < earliest) {
          reject("due date is in the past");
          break;
        }
        const dueAt = action.dueDate === null ? null : `${action.dueDate}T00:00:00.000Z`;
        result.mutations.push(seal({ op: "update_action_fields", id: step.id, patch: { due_at: dueAt } }));
        step.due_at = dueAt;
        break;
      }

      case "edit_win": {
        const event = eventsById.get(action.progressEventId);
        const title = cleanText(action.title, LIMITS.title);
        const error = !event ? "win not found" : checkWinTitle(title);
        if (error) {
          reject(error);
          break;
        }
        result.mutations.push(
          seal({
            op: "update_progress_event",
            id: event!.id,
            userId: state.userId,
            patch: {
              title: title!,
              learning: action.learning === undefined ? event!.learning : cleanText(action.learning, LIMITS.detail),
            },
          }),
        );
        break;
      }

      case "keep_context_item": {
        const item = itemsById.get(action.contextItemId);
        if (!item) {
          reject("item not found or already removed");
          break;
        }
        // Keeping means "this is right": an inference becomes something the person approved.
        const patch: ContextItemPatch = {
          temporal_status: "current",
          provenance: item.provenance === "ai_inferred" ? "user_approved" : item.provenance,
          semantic_status: item.semantic_status === "inference" ? "confirmed_context" : item.semantic_status,
        };
        result.mutations.push(seal({ op: "update_context_item", id: item.id, userId: state.userId, patch }));
        Object.assign(item, patch);
        break;
      }

      case "edit_context_item": {
        const item = itemsById.get(action.contextItemId);
        const text = cleanText(action.text, LIMITS.displayText);
        if (!item) {
          reject("item not found or already removed");
          break;
        }
        if (!text) {
          reject("text is empty or too long");
          break;
        }
        // The rewrite is the person's own words; the original is kept as superseded history.
        const id = crypto.randomUUID();
        result.mutations.push(
          seal({
            op: "insert_context_item",
            row: {
              id,
              user_id: state.userId,
              type: item.type,
              user_language: text,
              display_text: text,
              provenance: "user_authored",
              semantic_status: item.semantic_status === "inference" ? "confirmed_context" : item.semantic_status,
              temporal_status: "current",
              confidence: null,
            },
          }),
          seal({
            op: "update_context_item",
            id: item.id,
            userId: state.userId,
            patch: { temporal_status: "superseded", superseded_by: id },
          }),
        );
        itemsById.delete(item.id);
        break;
      }

      case "archive_context_item": {
        const item = itemsById.get(action.contextItemId);
        if (!item) {
          reject("item not found or already removed");
          break;
        }
        if (!canTransitionTemporal(item.temporal_status, "archived")) {
          reject(`cannot delete a '${item.temporal_status}' item`);
          break;
        }
        result.mutations.push(
          seal({ op: "update_context_item", id: item.id, userId: state.userId, patch: { temporal_status: "archived" } }),
        );
        itemsById.delete(item.id);
        break;
      }

      case "save_interest":
      case "confirm_goal": {
        const item = itemsById.get(action.contextItemId);
        const target: SemanticStatus = action.type === "save_interest" ? "saved_interest" : "confirmed_goal";
        const from = action.type === "save_interest" ? SAVE_FROM : CONFIRM_GOAL_FROM;
        if (!item || item.temporal_status !== "current") {
          reject("item not found or no longer current");
          break;
        }
        if (!from.includes(item.semantic_status)) {
          reject(`cannot move '${item.semantic_status}' to '${target}'`);
          break;
        }
        // The person's explicit action turns an inference into something they approved.
        const provenance: Provenance = item.provenance === "ai_inferred" ? "user_approved" : item.provenance;
        result.mutations.push(
          seal({
            op: "update_context_item",
            id: item.id,
            userId: state.userId,
            patch: { semantic_status: target, provenance },
          }),
        );
        item.semantic_status = target;
        item.provenance = provenance;
        break;
      }

      case "accept_route":
      case "dismiss_route":
      case "set_route_position": {
        if (!ownsPathway(state, action.pathwayId)) {
          reject("pathway not found");
          break;
        }
        const route = state.routes?.find((r) => r.pathway_id === action.pathwayId);
        if (action.type === "accept_route") {
          if (!route?.suggested_stops?.length) {
            reject("there is no suggested route to use");
            break;
          }
          // A new route starts where the person is: its first stop.
          result.mutations.push(
            seal({
              op: "upsert_route",
              pathwayId: action.pathwayId,
              patch: { confirmed_stops: route.suggested_stops, suggested_stops: null, position: 0 },
            }),
          );
        } else if (action.type === "dismiss_route") {
          if (!route?.suggested_stops) {
            reject("there is no suggested route to dismiss");
            break;
          }
          result.mutations.push(seal({ op: "upsert_route", pathwayId: action.pathwayId, patch: { suggested_stops: null } }));
        } else {
          if (!route?.confirmed_stops || action.position >= route.confirmed_stops.length) {
            reject("that stop is not on the route");
            break;
          }
          result.mutations.push(seal({ op: "upsert_route", pathwayId: action.pathwayId, patch: { position: action.position } }));
        }
        break;
      }

      case "record_win": {
        const title = cleanText(action.win.title, LIMITS.title);
        const error = checkMeaningfulWin(state, action.win.eventType, title, action.win.pathwayId);
        if (error) {
          reject(error);
          break;
        }
        result.mutations.push(
          seal({
            op: "insert_progress_event",
            row: {
              user_id: state.userId,
              pathway_id: action.win.pathwayId,
              event_type: action.win.eventType,
              title: title!,
              evidence_status: "user_reported",
              source: "user_recorded",
              learning: cleanText(action.win.learning, LIMITS.detail),
            },
          }),
        );
        break;
      }
    }
  }

  return result;
}
