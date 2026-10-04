import "server-only";
import { applyMutations } from "@/lib/db/mutations";
import { getRoute, listNextSteps, listRecentWins, loadGuardState } from "@/lib/db/queries";
import type { Action, PathwayRoute, ProgressEvent } from "@/lib/db/types";
import { guardUserActions, type Rejection, type UserAction } from "@/lib/validation/state-guard";

/** Applies explicit user actions through the state guard. Returns what was declined. */
export async function applyUserActions(userId: string, actions: UserAction[]): Promise<Rejection[]> {
  if (actions.length === 0) return [];
  const result = guardUserActions(await loadGuardState(userId), actions);
  for (const r of result.rejections) console.warn(`[state-guard] user action rejected: ${r.proposal} (${r.reason})`);
  await applyMutations(result.mutations);
  return result.rejections;
}

export async function loadPanels(
  userId: string,
  pathwayId: string | null,
): Promise<{ nextSteps: Action[]; recentWins: ProgressEvent[]; route: PathwayRoute | null }> {
  const [nextSteps, recentWins, route] = await Promise.all([
    pathwayId ? listNextSteps(pathwayId) : Promise.resolve([]),
    // Enough wins for every footstep on the route; the list itself shows them all on request.
    listRecentWins(userId, 100),
    pathwayId ? getRoute(pathwayId) : Promise.resolve(null),
  ]);
  return { nextSteps, recentWins, route };
}
