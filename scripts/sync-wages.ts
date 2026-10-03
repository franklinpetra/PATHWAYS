/**
 * Loads Washington occupational wage estimates (OEWS) from the Employment Security
 * Department's annual data book.
 *
 *   npm run sync:wages [-- --dry-run]
 *
 * Finds the current data book on ESD's OEWS page, reads its "Raw Data" sheet (statewide and
 * every Washington metropolitan and nonmetropolitan area), and upserts every occupation.
 * The as-of date is the workbook's own last-saved date. ESD publishes a new book each year.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { ESD_OEWS_PAGE, parseEsdWages } from "../lib/data/washington/esd-wages";
import { SOURCES, loadRows, makeStamp } from "../lib/data/washington";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const HEADERS = { "User-Agent": "Mozilla/5.0 (PATHWAYS data loader)" };

async function main() {
  const page = await fetch(ESD_OEWS_PAGE, { headers: HEADERS });
  if (!page.ok) fail(`Reading ${ESD_OEWS_PAGE} failed: ${page.status}`);
  const link = (await page.text()).match(/href="(\/media\/xls\/\d+\/oews-data-book-(\d{4})xls)"/);
  if (!link) fail("Couldn't find the OEWS data book link on ESD's page; check the page and update the pattern.");
  const bookUrl = new URL(link[1], ESD_OEWS_PAGE).toString();

  const res = await fetch(bookUrl, { headers: HEADERS });
  if (!res.ok) fail(`Downloading ${bookUrl} failed: ${res.status}`);
  const book = XLSX.read(new Uint8Array(await res.arrayBuffer()), { cellDates: true });
  const sheet = book.Sheets["Raw Data"];
  if (!sheet) fail(`The data book has no "Raw Data" sheet (sheets: ${book.SheetNames.join(", ")})`);

  const modified = book.Props?.ModifiedDate ? new Date(book.Props.ModifiedDate) : null;
  if (!modified || Number.isNaN(modified.getTime())) fail("The data book has no last-saved date to use as its as-of date.");
  const about = XLSX.utils.sheet_to_csv(book.Sheets["About the data"] ?? XLSX.utils.aoa_to_sheet([]));
  const aged = about.match(/updated wage data to the (\w+ quarter of \d{4})/i);
  const stamp = makeStamp("esd_oews", {
    sourceUrl: bookUrl,
    asOf: modified.toISOString().slice(0, 10),
    observationPeriod: `${link[2]} estimates${aged ? `, wages updated to the ${aged[1]}` : ""}`,
  });

  const { rows, errors, unknownAreas } = parseEsdWages(XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }), stamp);
  console.log(`${SOURCES.esd_oews.sourceName} (${stamp.observation_period}, as of ${stamp.source_as_of}) -> occupation_wages`);
  console.log(`  ${rows.length} occupation-area rows, ${new Set(rows.map((r) => r.area_name)).size} areas, ${errors.length} rejected`);
  for (const e of errors.slice(0, 25)) console.log(`  ${e}`);
  if (unknownAreas.length) fail(`Unmapped areas (add them to AREA_COUNTIES in lib/data/washington/esd-wages.ts): ${unknownAreas.join("; ")}`);
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
  const written = await loadRows(client, { table: "occupation_wages", conflict: "source_name,area_name,soc_code" }, rows);
  console.log(`\nWrote ${written} rows.`);
}

main().catch((err: Error) => fail(err.message));
