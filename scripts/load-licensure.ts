/**
 * Loads a reviewed licensure source packet.
 *
 *   npm run load:licensure -- --file data/licensure/wa/wac-246-945-990.json [--dry-run] [--offline]
 *
 * Steps, each failing closed:
 *   1. Validate the packet (amount states, currencies, authorities, occupations).
 *   2. Fetch the official source and confirm every excerpt is in it, and every known or
 *      zero fee's row label and amount are in its excerpts. --offline skips this (dry runs only).
 *   3. Require review (status "reviewed", reviewed_by, reviewed_on) unless --dry-run.
 *   4. Apply in one transaction via DATABASE_URL; --dry-run rolls back and reports.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { loadPacket } from "../lib/data/licensure/load";
import { excerptProblems, htmlToText, parsePacket, reviewProblems } from "../lib/data/licensure/packet";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
  },
});
const dryRun = values["dry-run"]!;
if (!values.file || !existsSync(values.file)) fail("--file must point to a licensure packet (.json)");
if (values.offline && !dryRun) fail("--offline is only allowed with --dry-run; a real load must check the source");

let json: unknown;
try {
  json = JSON.parse(readFileSync(values.file, "utf8"));
} catch (err) {
  fail(`Not valid JSON: ${(err as Error).message}`);
}
const parsed = parsePacket(json);
if ("errors" in parsed) fail(`Packet is invalid:\n  ${parsed.errors.join("\n  ")}`);
const packet = parsed.packet;
const today = new Date().toISOString().slice(0, 10);

async function main() {
  console.log(`${packet.source.name} (${packet.status})`);

  if (values.offline) {
    console.log("  Source check skipped (--offline).");
  } else {
    const res = await fetch(packet.source.url, { headers: { "User-Agent": "Pathways licensure loader" } });
    if (!res.ok) fail(`Couldn't fetch ${packet.source.url}: HTTP ${res.status}`);
    const problems = excerptProblems(packet, htmlToText(await res.text()));
    if (problems.length) fail(`Source check failed:\n  ${problems.join("\n  ")}`);
    console.log("  Source check passed: every excerpt and stated fee is in the official text.");
  }

  const review = reviewProblems(packet, today);
  if (review.length) {
    if (!dryRun) fail(`Not reviewed:\n  ${review.join("\n  ")}`);
    console.log(`  Review pending (fine for a dry run):\n    ${review.join("\n    ")}`);
  }

  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!process.env.DATABASE_URL) fail("DATABASE_URL must be set (e.g. in .env.local)");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const actions = await loadPacket(sql, packet, { dryRun });
    console.log(dryRun ? "\nWould apply:" : "\nApplied:");
    for (const a of actions) console.log(`  - ${a}`);
    if (dryRun) console.log("\nDry run: rolled back, nothing written.");
  } finally {
    await sql.end();
  }
}

main().catch((err: Error) => fail(err.message));
