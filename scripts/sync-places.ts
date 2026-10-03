/**
 * Loads Washington places (cities, towns, census-designated places) from the U.S. Census
 * Bureau, so a location like "Tacoma" resolves to coordinates and a county without guessing.
 *
 *   npm run sync:places [-- --dry-run]
 *
 * Safe to re-run; rows are upserted by name.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { GAZETTEER_URL, PLACE_BY_COUNTY_URL, joinCensusPlaces } from "../lib/data/washington/census-places";
import { loadRows, parseDelimited } from "../lib/data/washington";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

async function download(url: string) {
  const res = await fetch(url);
  if (!res.ok) fail(`Downloading ${url} failed: ${res.status} ${res.statusText}`);
  return parseDelimited(await res.text(), "|");
}

async function main() {
  const [gazetteer, placeByCounty] = await Promise.all([download(GAZETTEER_URL), download(PLACE_BY_COUNTY_URL)]);
  const rows = joinCensusPlaces({ gazetteer, placeByCounty });
  const multiCounty = rows.filter((r) => r.county === null).length;
  console.log(`U.S. Census Bureau Washington places -> places`);
  console.log(`  ${rows.length} places, ${multiCounty} spanning more than one county`);
  if (rows.length === 0) fail("No rows to load; leaving the table unchanged.");

  if (values["dry-run"]) {
    console.log("\nDry run: nothing written.");
    return;
  }

  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (e.g. in .env.local)");
  const written = await loadRows(createClient(url, key, { auth: { persistSession: false } }), { table: "places", conflict: "name,state" }, rows);
  console.log(`\nWrote ${written} places.`);
}

main().catch((err: Error) => fail(err.message));
