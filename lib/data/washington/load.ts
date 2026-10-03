import type { SupabaseClient } from "@supabase/supabase-js";
import type { Connector } from "./connectors";

const BATCH_SIZE = 500;

/** Upserts connector rows in batches. Re-running a load updates rows in place. */
export async function loadRows<T>(client: SupabaseClient, connector: Pick<Connector<T>, "table" | "conflict">, rows: T[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await client.from(connector.table).upsert(batch as object[], { onConflict: connector.conflict });
    if (error) throw new Error(`Loading ${connector.table} failed at row ${i + 1}: ${error.message}`);
    written += batch.length;
  }
  return written;
}
