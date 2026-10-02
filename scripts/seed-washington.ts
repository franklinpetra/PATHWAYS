/**
 * Loads a Washington source export into the database.
 *
 *   npm run seed:wa -- --source arts --file ./data/arts.csv \
 *     --source-url "https://..." --as-of 2026-09-15 [--observation-period "2024-25"] [--dry-run]
 *
 * Sources: arts (L&I apprenticeships), career_bridge, sbctc (training programs), onet (occupations).
 * --source-url and --as-of are required: they become the attribution shown with every claim.
 * Always run with --dry-run first to see which rows are rejected and why.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { CONNECTORS, SOURCES, loadRows, makeStamp, parseDelimited, runConnector, type SourceKey } from "../lib/data/washington";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    file: { type: "string" },
    "source-url": { type: "string" },
    "as-of": { type: "string" },
    "observation-period": { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const source = values.source as SourceKey | undefined;
if (!source || !(source in SOURCES)) fail(`--source must be one of: ${Object.keys(SOURCES).join(", ")}`);
if (!values.file || !existsSync(values.file)) fail("--file must point to an existing CSV or TSV export");
if (!values["source-url"] || !values["as-of"]) fail("--source-url and --as-of are required");

let stamp;
try {
  stamp = makeStamp(source, {
    sourceUrl: values["source-url"],
    asOf: values["as-of"],
    observationPeriod: values["observation-period"],
  });
} catch (err) {
  fail((err as Error).message);
}

const connector = CONNECTORS[source];
const parsed = parseDelimited(readFileSync(values.file, "utf8"));
const result = runConnector<object>(connector, parsed, stamp);

if (result.missingColumns.length > 0) {
  fail(
    `Missing required columns: ${result.missingColumns.join(", ")}.\n` +
      `Headers found: ${parsed.headers.join(" | ")}\n` +
      `Add the export's header name to the field's list in lib/data/washington/connectors.ts.`,
  );
}

console.log(`${SOURCES[source].sourceName} -> ${connector.table}`);
console.log(`  ${parsed.records.length} records read, ${result.rows.length} valid, ${result.errors.length} rejected`);
for (const e of result.errors.slice(0, 25)) console.log(`  line ${e.line}: ${e.message}`);
if (result.errors.length > 25) console.log(`  …and ${result.errors.length - 25} more`);

if (values["dry-run"]) {
  console.log("\nDry run: nothing written.");
  process.exit(0);
}

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (e.g. in .env.local)");

loadRows(createClient(url, key, { auth: { persistSession: false } }), connector, result.rows).then(
  (written) => console.log(`\nWrote ${written} rows to ${connector.table}.`),
  (err: Error) => fail(err.message),
);
