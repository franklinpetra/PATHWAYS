/**
 * Syncs Washington registered apprenticeships from L&I's ARTS open data on data.wa.gov.
 *
 *   npm run sync:apprenticeships [-- --dry-run]
 *
 * Downloads the program, occupation, and county datasets, joins them, upserts every active
 * program occupation, and removes rows for programs that are no longer active. The as-of
 * date is the dataset's own last-updated date, so the attribution shown with every claim
 * says when L&I last published it. Safe to re-run; L&I updates the data monthly.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { ARTS_DATASET_PAGE, ARTS_DATASETS, artsDownloadUrl, joinArtsOpenData } from "../lib/data/washington/arts-open-data";
import { SOURCES, loadRows, makeStamp, parseDelimited } from "../lib/data/washington";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

async function download(id: string) {
  const res = await fetch(artsDownloadUrl(id));
  if (!res.ok) fail(`Downloading data.wa.gov dataset ${id} failed: ${res.status} ${res.statusText}`);
  return parseDelimited(await res.text());
}

/** The date L&I last updated a dataset, from data.wa.gov's metadata. */
async function lastUpdated(id: string): Promise<string> {
  const res = await fetch(`https://data.wa.gov/api/views/${id}.json`);
  if (!res.ok) fail(`Reading metadata for dataset ${id} failed: ${res.status}`);
  const meta = (await res.json()) as { rowsUpdatedAt?: number };
  if (!meta.rowsUpdatedAt) fail(`Dataset ${id} has no last-updated date`);
  return new Date(meta.rowsUpdatedAt * 1000).toISOString().slice(0, 10);
}

async function main() {
  const ids = Object.values(ARTS_DATASETS);
  // The oldest of the three dates is the honest as-of for the joined rows.
  const asOf = (await Promise.all(ids.map(lastUpdated))).sort()[0];
  const [programs, occupations, counties] = await Promise.all(ids.map(download));

  const stamp = makeStamp("arts", { sourceUrl: ARTS_DATASET_PAGE, asOf });
  const { rows, errors, skipped } = joinArtsOpenData({ programs, occupations, counties }, stamp);

  console.log(`${SOURCES.arts.sourceName} (data.wa.gov, as of ${asOf}) -> apprenticeships`);
  console.log(`  ${occupations.records.length} program occupations read`);
  console.log(`  ${rows.length} active in Washington, ${skipped.inactive} inactive, ${skipped.outsideWashington} without a Washington county, ${errors.length} rejected`);
  for (const e of errors.slice(0, 25)) console.log(`  line ${e.line}: ${e.message}`);
  if (rows.length === 0) fail("No rows to load; leaving the table unchanged.");

  if (values["dry-run"]) {
    console.log("\nDry run: nothing written.");
    return;
  }

  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (e.g. in .env.local)");
  const client = createClient(url, key, { auth: { persistSession: false } });

  const written = await loadRows(client, { table: "apprenticeships", conflict: "source_name,source_record_id" }, rows);
  const { count, error } = await client
    .from("apprenticeships")
    .delete({ count: "exact" })
    .eq("source_name", SOURCES.arts.sourceName)
    .not("source_record_id", "in", `(${rows.map((r) => r.source_record_id).join(",")})`);
  if (error) fail(`Removing inactive programs failed: ${error.message}`);
  console.log(`\nWrote ${written} rows; removed ${count ?? 0} no longer active.`);
}

main().catch((err: Error) => fail(err.message));
