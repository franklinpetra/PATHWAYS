import "server-only";
import { db } from "./supabase";
import type { Action, ContextItem, Occupation, Pathway, Place, ProgramMatch, ProgressEvent, User } from "./types";
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

export async function listPathways(userId: string): Promise<Pathway[]> {
  const res = await db().from("pathways").select("*").eq("user_id", userId);
  return unwrap<Pathway[]>(res, "pathways");
}

export async function listActionsForPathways(pathwayIds: string[]): Promise<Action[]> {
  if (pathwayIds.length === 0) return [];
  const res = await db().from("actions").select("*").in("pathway_id", pathwayIds).order("display_order");
  return unwrap<Action[]>(res, "actions");
}

/** Open Next Steps for a pathway: suggested or adopted, not yet complete. */
export async function listNextSteps(pathwayId: string): Promise<Action[]> {
  const res = await db()
    .from("actions")
    .select("*")
    .eq("pathway_id", pathwayId)
    .in("status", ["suggested", "user_selected"])
    .order("display_order");
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

/** Snapshot of a person's state for the state guard. */
export async function loadGuardState(userId: string): Promise<GuardState> {
  const [contextItems, pathways] = await Promise.all([listLiveContextItems(userId), listPathways(userId)]);
  const actions = await listActionsForPathways(pathways.map((p) => p.id));
  return { userId, contextItems, pathways, actions };
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

export async function searchPrograms(params: {
  socCodes: string[];
  latitude: number | null;
  longitude: number | null;
  radiusMiles: number | null;
  limit?: number;
}): Promise<ProgramMatch[]> {
  const res = await db().rpc("search_programs", {
    p_soc_codes: params.socCodes,
    p_latitude: params.latitude,
    p_longitude: params.longitude,
    p_radius_miles: params.radiusMiles,
    p_limit: params.limit ?? 8,
  });
  return unwrap<ProgramMatch[]>(res, "programs");
}
