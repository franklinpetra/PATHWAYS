import "server-only";
import { db } from "./supabase";
import type {
  Action,
  Apprenticeship,
  ContextItem,
  CredentialMatch,
  Occupation,
  OccupationWage,
  PathwayRoute,
  Pathway,
  Place,
  ProgressEvent,
  StoredMessage,
  TrainingProgramMatch,
  User,
} from "./types";
import type { GuardState } from "@/lib/validation/state-guard";

// Read-only access. Writes live in ./mutations.ts and accept only guard-validated input.

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Failed to load ${what}: ${result.error.message}`);
  return result.data as T;
}

export async function findUserByAccessCodeHash(hash: string): Promise<User | null> {
  const res = await db().from("users").select("*").eq("access_code_hash", hash).maybeSingle();
  return unwrap<User | null>(res, "user");
}

/** Context items that can still inform the conversation (current or stale). */
export async function listLiveContextItems(userId: string): Promise<ContextItem[]> {
  const res = await db()
    .from("context_items")
    .select("*")
    .eq("user_id", userId)
    .in("temporal_status", ["current", "stale"])
    .order("updated_at", { ascending: false })
    .limit(200);
  return unwrap<ContextItem[]>(res, "context items");
}

export async function listArchivedContextItems(userId: string): Promise<ContextItem[]> {
  const res = await db()
    .from("context_items")
    .select("*")
    .eq("user_id", userId)
    .eq("temporal_status", "archived")
    .order("updated_at", { ascending: false })
    .limit(200);
  return unwrap<ContextItem[]>(res, "deleted context items");
}

/** Everything remembered, in every state, for the My Story page. */
export async function listAllContextItems(userId: string): Promise<ContextItem[]> {
  const res = await db()
    .from("context_items")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(500);
  return unwrap<ContextItem[]>(res, "context items");
}

export async function listPathways(userId: string): Promise<Pathway[]> {
  const res = await db().from("pathways").select("*").eq("user_id", userId);
  return unwrap<Pathway[]>(res, "pathways");
}

export async function listActionsForPathways(pathwayIds: string[]): Promise<Action[]> {
  if (pathwayIds.length === 0) return [];
  const res = await db().from("actions").select("*").in("pathway_id", pathwayIds).order("display_order");
  return unwrap<Action[]>(res, "actions");
}

export async function getPathway(userId: string, pathwayId: string): Promise<Pathway | null> {
  const res = await db().from("pathways").select("*").eq("id", pathwayId).eq("user_id", userId).maybeSingle();
  return unwrap<Pathway | null>(res, "pathway");
}

/** Visible Next Steps for a pathway: open, not removed, and not postponed past now. */
export async function listNextSteps(pathwayId: string, now = new Date()): Promise<Action[]> {
  const res = await db()
    .from("actions")
    .select("*")
    .eq("pathway_id", pathwayId)
    .in("status", ["suggested", "user_selected"])
    .is("removed_at", null)
    .or(`postponed_until.is.null,postponed_until.lte.${now.toISOString()}`)
    .order("display_order")
    .order("created_at");
  return unwrap<Action[]>(res, "next steps");
}

export async function listRecentWins(userId: string, limit = 5): Promise<ProgressEvent[]> {
  const res = await db()
    .from("progress_events")
    .select("*")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return unwrap<ProgressEvent[]>(res, "recent wins");
}

/** The most recent messages in a thread, oldest first. A null pathway is the general thread. */
export async function listMessages(userId: string, pathwayId: string | null, limit = 50): Promise<StoredMessage[]> {
  let query = db().from("messages").select("*").eq("user_id", userId);
  query = pathwayId ? query.eq("pathway_id", pathwayId) : query.is("pathway_id", null);
  const res = await query.order("created_at", { ascending: false }).limit(limit);
  return unwrap<StoredMessage[]>(res, "messages").reverse();
}

/** Snapshot of a person's state for the state guard. */
export async function loadGuardState(userId: string): Promise<GuardState> {
  const [contextItems, archivedContextItems, pathways, progressEvents] = await Promise.all([
    listLiveContextItems(userId),
    listArchivedContextItems(userId),
    listPathways(userId),
    listRecentWins(userId, 50),
  ]);
  const ids = pathways.map((p) => p.id);
  const [actions, routes] = await Promise.all([listActionsForPathways(ids), listRoutes(ids)]);
  return { userId, contextItems, archivedContextItems, pathways, actions, progressEvents, routes };
}

export async function listRoutes(pathwayIds: string[]): Promise<PathwayRoute[]> {
  if (pathwayIds.length === 0) return [];
  const res = await db().from("pathway_routes").select("*").in("pathway_id", pathwayIds);
  return unwrap<PathwayRoute[]>(res, "routes");
}

export async function getRoute(pathwayId: string): Promise<PathwayRoute | null> {
  const res = await db().from("pathway_routes").select("*").eq("pathway_id", pathwayId).maybeSingle();
  return unwrap<PathwayRoute | null>(res, "route");
}

// ---------------------------------------------------------------------------
// Authoritative source tables (Fact-Finder)
// ---------------------------------------------------------------------------

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function findOccupations(phrase: string, limit = 3): Promise<Occupation[]> {
  const res = await db()
    .from("occupations")
    .select("*")
    .ilike("title", `%${escapeLike(phrase.trim())}%`)
    .limit(limit);
  return unwrap<Occupation[]>(res, "occupations");
}

/** Wage estimates for these SOC codes in one OEWS area and statewide. */
export async function findOccupationWages(socCodes: string[], areaName: string): Promise<OccupationWage[]> {
  if (socCodes.length === 0) return [];
  const res = await db()
    .from("occupation_wages")
    .select("*")
    .in("soc_code", socCodes)
    .in("area_name", [...new Set([areaName, "Washington"])]);
  return unwrap<OccupationWage[]>(res, "occupation wages");
}

export async function findPlace(name: string, state = "WA"): Promise<Place | null> {
  const res = await db()
    .from("places")
    .select("*")
    .ilike("name", escapeLike(name.trim()))
    .eq("state", state)
    .limit(1)
    .maybeSingle();
  return unwrap<Place | null>(res, "place");
}

export async function searchTrainingPrograms(params: {
  socCodes: string[];
  latitude: number | null;
  longitude: number | null;
  radiusMiles: number | null;
  limit?: number;
}): Promise<TrainingProgramMatch[]> {
  const res = await db().rpc("search_training_programs", {
    p_soc_codes: params.socCodes,
    p_latitude: params.latitude,
    p_longitude: params.longitude,
    p_radius_miles: params.radiusMiles,
    p_limit: params.limit ?? 8,
  });
  return unwrap<TrainingProgramMatch[]>(res, "training programs");
}

/** Credential versions in effect on `on` for the occupations, in a jurisdiction (default Washington). */
export async function searchCredentials(params: {
  socCodes: string[];
  jurisdictionCode?: string;
  on?: string;
  limit?: number;
}): Promise<CredentialMatch[]> {
  if (params.socCodes.length === 0) return [];
  const res = await db().rpc("search_credentials", {
    p_soc_codes: params.socCodes,
    p_jurisdiction_code: params.jurisdictionCode ?? "US-WA",
    p_on: params.on ?? new Date().toISOString().slice(0, 10),
    p_limit: params.limit ?? 8,
  });
  return unwrap<CredentialMatch[]>(res, "credentials");
}

export async function searchApprenticeships(params: {
  socCodes: string[];
  trade: string | null;
  county: string | null;
  limit?: number;
}): Promise<Apprenticeship[]> {
  const res = await db().rpc("search_apprenticeships", {
    p_soc_codes: params.socCodes,
    p_trade: params.trade ? escapeLike(params.trade.trim()) : null,
    p_county: params.county,
    p_limit: params.limit ?? 6,
  });
  return unwrap<Apprenticeship[]>(res, "apprenticeships");
}
