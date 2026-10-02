import "server-only";
import { db } from "./supabase";
import type { ValidatedMutation } from "@/lib/validation/state-guard";

/**
 * The only write path in the application. It accepts nothing but mutations
 * produced by the state guard, so model output can never reach the database
 * without passing deterministic validation first.
 *
 * Mutations are applied in order; the guard emits inserts before the updates
 * that reference them (e.g. superseded_by).
 */
export async function applyMutations(mutations: readonly ValidatedMutation[]): Promise<void> {
  for (const m of mutations) {
    const res = await apply(m);
    if (res.error) throw new Error(`Failed to apply ${m.op}: ${res.error.message}`);
  }
}

function apply(m: ValidatedMutation) {
  switch (m.op) {
    case "insert_context_item":
      return db().from("context_items").insert(m.row);
    case "update_context_item":
      return db().from("context_items").update(m.patch).eq("id", m.id).eq("user_id", m.userId);
    case "insert_action":
      return db().from("actions").insert(m.row);
    case "update_action_status":
      return db().from("actions").update({ status: m.status }).eq("id", m.id).eq("status", m.from);
    case "insert_progress_event":
      return db().from("progress_events").insert(m.row);
  }
}
