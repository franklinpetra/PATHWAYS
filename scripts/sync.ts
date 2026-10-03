/**
 * Refreshes Washington source data by hand. The same refreshes run on a schedule through
 * /api/cron/sync (see vercel.json); this is for a first load, a dry run, or an urgent update.
 *
 *   npm run sync -- apprenticeships|wages|places|all [--dry-run]
 *
 * Runs are recorded in data_sync_runs, which the health check reads.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { SYNC_SOURCES, dryRunSync, runSync, type SyncSource } from "../lib/data/washington/sync";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "dry-run": { type: "boolean", default: false } },
});
const target = positionals[0];
const sources: SyncSource[] =
  target === "all" ? [...SYNC_SOURCES] : SYNC_SOURCES.includes(target as SyncSource) ? [target as SyncSource] : [];
if (sources.length === 0) {
  console.error(`\nUsage: npm run sync -- ${[...SYNC_SOURCES, "all"].join("|")} [--dry-run]\n`);
  process.exit(1);
}

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!values["dry-run"] && (!url || !key)) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  const client = values["dry-run"] ? null : createClient(url!, key!, { auth: { persistSession: false } });

  let failed = false;
  for (const source of sources) {
    try {
      const result = client ? await runSync(client, source, "manual") : await dryRunSync(source);
      console.log(`\n${source}:\n  ${result.summary.join("\n  ")}`);
      console.log(result.dryRun ? "  Dry run: nothing written." : `  Wrote ${result.written} rows; removed ${result.removed}.`);
    } catch (err) {
      failed = true;
      console.error(`\n${source} failed: ${(err as Error).message}`);
    }
  }
  if (failed) process.exit(1);
}

main().catch((err: Error) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
