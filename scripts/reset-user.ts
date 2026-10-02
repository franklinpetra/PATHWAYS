/**
 * Resets one person to a blank slate for testing, keeping their account and access code.
 *
 *   npm run reset-user -- --username dana --dry-run
 *   npm run reset-user -- --username dana --yes [--pathway "Exploring my next step"]
 *
 * Deletes, in one transaction: pathways (and their Next Steps), messages, remembered
 * context (context_items), Recent Wins (progress_events), and handoff links.
 * Sessions are signed cookies, not database rows: sign out in the browser afterwards.
 * Source data (occupations, programs, apprenticeships, licensure) is never touched.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import postgres from "postgres";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    username: { type: "string" },
    pathway: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
});
const username = values.username?.trim() ?? "";
if (!username) fail("--username is required");
if (!values["dry-run"] && !values.yes) fail("This deletes data. Run with --dry-run to preview, then --yes to proceed.");

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL) fail("DATABASE_URL must be set (e.g. in .env.local)");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

class Rollback extends Error {}

async function main() {
  const [user] = await sql<{ id: string }[]>`select id from users where username = ${username}`;
  if (!user) fail(`No user named "${username}".`);

  const [counts] = await sql<Record<string, number>[]>`
    select
      (select count(*) from pathways where user_id = ${user.id})::int as pathways,
      (select count(*) from actions a join pathways p on p.id = a.pathway_id where p.user_id = ${user.id})::int as next_steps,
      (select count(*) from messages where user_id = ${user.id})::int as messages,
      (select count(*) from context_items where user_id = ${user.id})::int as remembered_context,
      (select count(*) from progress_events where user_id = ${user.id})::int as recent_wins,
      (select count(*) from handoff_tokens where user_id = ${user.id})::int as handoff_links`;
  console.log(`${username}: ${Object.entries(counts).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ")}`);

  let newPathwayId: string | null = null;
  try {
    await sql.begin(async (tx) => {
      await tx`delete from messages where user_id = ${user.id}`;
      await tx`delete from progress_events where user_id = ${user.id}`;
      await tx`delete from context_items where user_id = ${user.id}`;
      await tx`delete from handoff_tokens where user_id = ${user.id}`;
      await tx`delete from pathways where user_id = ${user.id}`; // cascades to actions
      if (values.pathway?.trim()) {
        const [row] = await tx<{ id: string }[]>`
          insert into pathways (user_id, title, readiness_state, status)
          values (${user.id}, ${values.pathway.trim()}, 'exploring', 'exploratory') returning id`;
        newPathwayId = row.id;
      }
      if (values["dry-run"]) throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
    console.log("\nDry run: everything above would be deleted. Nothing was changed.");
    return;
  }

  console.log(`\nReset ${username}. The account and access code are unchanged.`);
  if (newPathwayId) console.log(`Fresh pathway: /pathways/${newPathwayId}`);
  console.log("Sign out in the browser (or clear the site's cookies) to start a new session.");
}

main()
  .catch((err: Error) => fail(err.message))
  .finally(() => sql.end());
