import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { ARTS_DATASET_PAGE, ARTS_DATASETS, artsDownloadUrl, joinArtsOpenData } from "./arts-open-data";
import waCurated from "../../../data/stepping-stones/wa-curated.json";
import waFastHire from "../../../data/stepping-stones/wa-fast-hire.json";
import waInternational from "../../../data/stepping-stones/wa-international.json";
import waReentry from "../../../data/stepping-stones/wa-reentry.json";
import waSeattle from "../../../data/stepping-stones/wa-seattle.json";
import waYouth from "../../../data/stepping-stones/wa-youth.json";
import { CURATED_PREFIX, curatedRows } from "./curated-stepping-stones";
import { joinCensusPlaces, placeByCountyUrl, gazetteerUrl } from "./census-places";
import { parseDelimited } from "./csv";
import { ESD_OEWS_PAGE, parseEsdWages } from "./esd-wages";
import { LNI_PREP_PAGE, parseLniPrepPrograms } from "./lni-prep-programs";
import { loadRows } from "./load";
import { SOURCES, makeStamp } from "./sources";

/**
 * Refreshes for each Washington source, shared by the npm scripts and the scheduled
 * /api/cron/sync route. Every refresh is idempotent (upserts by natural key), so a duplicate
 * or retried run is harmless, and each one fails closed: a download that looks partial
 * aborts before anything is written, so a bad day at a source never empties a table.
 */

export type SyncSource = "apprenticeships" | "wages" | "places" | "stepping_stones";
export const SYNC_SOURCES: readonly SyncSource[] = ["apprenticeships", "wages", "places", "stepping_stones"];

export interface SyncResult {
  source: SyncSource;
  asOf: string | null;
  written: number;
  removed: number;
  summary: string[];
  dryRun: boolean;
}

export interface SyncOptions {
  dryRun?: boolean;
}

/** Below this share of the rows already loaded, a new download is treated as partial. */
const MIN_SHARE_OF_EXISTING = 0.5;
const HEADERS = { "User-Agent": "Mozilla/5.0 (PATHWAYS data loader)" };

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`Downloading ${url} failed: ${res.status} ${res.statusText}`);
  return res;
}

async function existingCount(client: SupabaseClient, table: string, sourceName?: string): Promise<number> {
  let query = client.from(table).select("*", { count: "exact", head: true });
  if (sourceName) query = query.eq("source_name", sourceName);
  const { count, error } = await query;
  if (error) throw new Error(`Counting ${table} failed: ${error.message}`);
  return count ?? 0;
}

export function guardPartial(table: string, incoming: number, existing: number) {
  if (incoming === 0) throw new Error(`No ${table} rows in the download; leaving the table unchanged.`);
  if (existing > 0 && incoming < existing * MIN_SHARE_OF_EXISTING) {
    throw new Error(
      `The download has ${incoming} ${table} rows, under half of the ${existing} already loaded; it looks partial, so nothing was written.`,
    );
  }
}

// ---------------------------------------------------------------------------
// L&I ARTS registered apprenticeships (data.wa.gov, updated monthly)
// ---------------------------------------------------------------------------

/** The date L&I last updated a dataset, from data.wa.gov's metadata. */
async function lastUpdated(id: string): Promise<string> {
  const meta = (await (await get(`https://data.wa.gov/api/views/${id}.json`)).json()) as { rowsUpdatedAt?: number };
  if (!meta.rowsUpdatedAt) throw new Error(`Dataset ${id} has no last-updated date`);
  return new Date(meta.rowsUpdatedAt * 1000).toISOString().slice(0, 10);
}

export async function syncApprenticeships(client: SupabaseClient | null, opts: SyncOptions = {}): Promise<SyncResult> {
  const ids = Object.values(ARTS_DATASETS);
  // The oldest of the three dates is the honest as-of for the joined rows.
  const asOf = (await Promise.all(ids.map(lastUpdated))).sort()[0];
  const [programs, occupations, counties] = await Promise.all(
    ids.map(async (id) => parseDelimited(await (await get(artsDownloadUrl(id))).text())),
  );
  const stamp = makeStamp("arts", { sourceUrl: ARTS_DATASET_PAGE, asOf });
  const { rows, errors, skipped } = joinArtsOpenData({ programs, occupations, counties }, stamp);
  const summary = [
    `${SOURCES.arts.sourceName} (data.wa.gov, as of ${asOf})`,
    `${occupations.records.length} program occupations read: ${rows.length} active in Washington, ${skipped.inactive} inactive, ${skipped.outsideWashington} without a Washington county, ${errors.length} rejected`,
    ...errors.slice(0, 10).map((e) => `line ${e.line}: ${e.message}`),
  ];
  if (opts.dryRun || !client) {
    if (rows.length === 0) throw new Error("No apprenticeship rows in the download.");
    return { source: "apprenticeships", asOf, written: 0, removed: 0, summary, dryRun: true };
  }

  guardPartial("apprenticeships", rows.length, await existingCount(client, "apprenticeships", SOURCES.arts.sourceName));
  const written = await loadRows(client, { table: "apprenticeships", conflict: "source_name,source_record_id" }, rows);
  // Programs L&I no longer lists as active are removed, so they are never offered as open.
  const { count, error } = await client
    .from("apprenticeships")
    .delete({ count: "exact" })
    .eq("source_name", SOURCES.arts.sourceName)
    .not("source_record_id", "in", `(${rows.map((r) => r.source_record_id).join(",")})`);
  if (error) throw new Error(`Removing inactive programs failed: ${error.message}`);
  return { source: "apprenticeships", asOf, written, removed: count ?? 0, summary, dryRun: false };
}

// ---------------------------------------------------------------------------
// ESD occupational wage estimates (annual data book)
// ---------------------------------------------------------------------------

export async function syncWages(client: SupabaseClient | null, opts: SyncOptions = {}): Promise<SyncResult> {
  const page = await (await get(ESD_OEWS_PAGE)).text();
  const link = page.match(/href="(\/media\/xls\/\d+\/oews-data-book-(\d{4})xls)"/);
  if (!link) throw new Error("Couldn't find the OEWS data book link on ESD's page; check the page and update the pattern.");
  const bookUrl = new URL(link[1], ESD_OEWS_PAGE).toString();

  const book = XLSX.read(new Uint8Array(await (await get(bookUrl)).arrayBuffer()), { cellDates: true });
  const sheet = book.Sheets["Raw Data"];
  if (!sheet) throw new Error(`The data book has no "Raw Data" sheet (sheets: ${book.SheetNames.join(", ")})`);
  const modified = book.Props?.ModifiedDate ? new Date(book.Props.ModifiedDate) : null;
  if (!modified || Number.isNaN(modified.getTime())) throw new Error("The data book has no last-saved date to use as its as-of date.");
  const about = XLSX.utils.sheet_to_csv(book.Sheets["About the data"] ?? XLSX.utils.aoa_to_sheet([]));
  const aged = about.match(/updated wage data to the (\w+ quarter of \d{4})/i);
  const asOf = modified.toISOString().slice(0, 10);
  const stamp = makeStamp("esd_oews", {
    sourceUrl: bookUrl,
    asOf,
    observationPeriod: `${link[2]} estimates${aged ? `, wages updated to the ${aged[1]}` : ""}`,
  });

  const { rows, errors, unknownAreas } = parseEsdWages(XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }), stamp);
  if (unknownAreas.length) {
    throw new Error(`Unmapped OEWS areas (add them to AREA_COUNTIES in lib/data/washington/esd-wages.ts): ${unknownAreas.join("; ")}`);
  }
  const summary = [
    `${SOURCES.esd_oews.sourceName} (${stamp.observation_period}, as of ${asOf})`,
    `${rows.length} occupation-area rows across ${new Set(rows.map((r) => r.area_name)).size} areas, ${errors.length} rejected`,
    ...errors.slice(0, 10),
  ];
  if (opts.dryRun || !client) {
    if (rows.length === 0) throw new Error("No wage rows in the download.");
    return { source: "wages", asOf, written: 0, removed: 0, summary, dryRun: true };
  }

  guardPartial("occupation_wages", rows.length, await existingCount(client, "occupation_wages", SOURCES.esd_oews.sourceName));
  const written = await loadRows(client, { table: "occupation_wages", conflict: "source_name,area_name,soc_code" }, rows);
  return { source: "wages", asOf, written, removed: 0, summary, dryRun: false };
}

// ---------------------------------------------------------------------------
// U.S. Census Bureau places (annual Gazetteer)
// ---------------------------------------------------------------------------

/** The newest Gazetteer the Census Bureau has published, trying this year and the two before. */
async function latestGazetteer(): Promise<{ year: number; text: string }> {
  const thisYear = new Date().getUTCFullYear();
  for (const year of [thisYear, thisYear - 1, thisYear - 2]) {
    const res = await fetch(gazetteerUrl(year), { headers: HEADERS, cache: "no-store" });
    if (res.ok) return { year, text: await res.text() };
  }
  throw new Error(`No Census Gazetteer place file found for ${thisYear - 2}-${thisYear}.`);
}

export async function syncPlaces(client: SupabaseClient | null, opts: SyncOptions = {}): Promise<SyncResult> {
  const [{ year, text }, placeByCounty] = await Promise.all([latestGazetteer(), get(placeByCountyUrl).then((r) => r.text())]);
  const rows = joinCensusPlaces({ gazetteer: parseDelimited(text, "|"), placeByCounty: parseDelimited(placeByCounty, "|") });
  const summary = [
    `U.S. Census Bureau ${year} Gazetteer, Washington places`,
    `${rows.length} places, ${rows.filter((r) => r.county === null).length} spanning more than one county`,
  ];
  if (opts.dryRun || !client) {
    if (rows.length === 0) throw new Error("No places in the download.");
    return { source: "places", asOf: null, written: 0, removed: 0, summary, dryRun: true };
  }

  guardPartial("places", rows.length, await existingCount(client, "places"));
  const written = await loadRows(client, { table: "places", conflict: "name,state" }, rows);
  return { source: "places", asOf: null, written, removed: 0, summary, dryRun: false };
}

// ---------------------------------------------------------------------------
// Stepping stones: L&I's recognized apprenticeship preparation programs (official page),
// plus reviewed curated programs whose quotes still appear on their own pages
// ---------------------------------------------------------------------------

export async function syncSteppingStones(client: SupabaseClient | null, opts: SyncOptions = {}): Promise<SyncResult> {
  const html = await (await get(LNI_PREP_PAGE)).text();
  // The page has no published date; the as-of date is the day it was read.
  const asOf = new Date().toISOString().slice(0, 10);
  const stamp = makeStamp("lni_prep", { sourceUrl: LNI_PREP_PAGE, asOf });
  const { rows: official, skipped } = parseLniPrepPrograms(html, stamp);
  // Each packet is reviewed on its own; a draft packet loads nothing.
  const packets = await Promise.all(
    [waCurated, waReentry, waFastHire, waInternational, waSeattle, waYouth].map((packet) => curatedRows(packet, async (url) => (await get(url)).text(), asOf)),
  );
  const curated = { rows: packets.flatMap((p) => p.rows), notes: packets.flatMap((p) => p.notes) };
  const rows = [...official, ...curated.rows];
  const summary = [
    `${SOURCES.lni_prep.sourceName} (L&I page, read ${asOf})`,
    `${official.length} programs, ${official.filter((r) => !r.open_enrollment).length} not open for public enrollment`,
    ...skipped,
    `Curated programs: ${curated.rows.length} loaded`,
    ...curated.notes,
  ];
  if (opts.dryRun || !client) {
    if (rows.length === 0) throw new Error("No programs found on L&I's page.");
    return { source: "stepping_stones", asOf, written: 0, removed: 0, summary, dryRun: true };
  }

  // County and coordinates come from the Census places table, so programs match by distance.
  const cities = [...new Set(rows.map((r) => r.city).filter((c): c is string => !!c))];
  const { data: places, error: placesError } = await client
    .from("places")
    .select("name, county, latitude, longitude")
    .in("name", cities);
  if (placesError) throw new Error(`Looking up program locations failed: ${placesError.message}`);
  type PlaceRow = { name: string; county: string | null; latitude: number; longitude: number };
  const byCity = new Map(((places ?? []) as PlaceRow[]).map((p) => [p.name.toLowerCase(), p]));
  for (const row of rows) {
    const place = row.city ? byCity.get(row.city.toLowerCase()) : undefined;
    row.county ??= place?.county ?? null;
    row.latitude = place?.latitude ?? null;
    row.longitude = place?.longitude ?? null;
  }

  guardPartial("stepping_stones", official.length, await existingCount(client, "stepping_stones", SOURCES.lni_prep.sourceName));
  const written = await loadRows(client, { table: "stepping_stones", conflict: "source_name,source_record_id" }, rows);
  // Programs L&I no longer recognizes are removed.
  const { count, error } = await client
    .from("stepping_stones")
    .delete({ count: "exact" })
    .eq("source_name", SOURCES.lni_prep.sourceName)
    .not("source_record_id", "in", `(${official.map((r) => r.source_record_id).join(",")})`);
  if (error) throw new Error(`Removing programs L&I no longer lists failed: ${error.message}`);
  // Curated programs that are no longer reviewed or verifiable are removed too.
  let stale = client.from("stepping_stones").delete({ count: "exact" }).like("source_record_id", `${CURATED_PREFIX}%`);
  if (curated.rows.length) stale = stale.not("source_record_id", "in", `(${curated.rows.map((r) => `"${r.source_record_id}"`).join(",")})`);
  const { count: curatedRemoved, error: curatedError } = await stale;
  if (curatedError) throw new Error(`Removing unverified curated programs failed: ${curatedError.message}`);
  return { source: "stepping_stones", asOf, written, removed: (count ?? 0) + (curatedRemoved ?? 0), summary, dryRun: false };
}

// ---------------------------------------------------------------------------

const SYNCS: Record<SyncSource, (client: SupabaseClient | null, opts?: SyncOptions) => Promise<SyncResult>> = {
  apprenticeships: syncApprenticeships,
  wages: syncWages,
  places: syncPlaces,
  stepping_stones: syncSteppingStones,
};

/** Runs one refresh and records it in data_sync_runs, whether it succeeds or fails. */
export async function runSync(client: SupabaseClient, source: SyncSource, trigger: "cron" | "manual"): Promise<SyncResult> {
  const { data: run, error } = await client.from("data_sync_runs").insert({ source, trigger }).select("id").single();
  if (error) throw new Error(`Recording the ${source} sync failed: ${error.message}`);
  const finish = (fields: Record<string, unknown>) =>
    client.from("data_sync_runs").update({ finished_at: new Date().toISOString(), ...fields }).eq("id", run.id);
  try {
    const result = await SYNCS[source](client);
    await finish({
      ok: true,
      rows_written: result.written,
      rows_removed: result.removed,
      source_as_of: result.asOf,
      message: result.summary.join("\n"),
    });
    return result;
  } catch (err) {
    await finish({ ok: false, message: (err as Error).message });
    throw err;
  }
}

export function dryRunSync(source: SyncSource): Promise<SyncResult> {
  return SYNCS[source](null, { dryRun: true });
}
