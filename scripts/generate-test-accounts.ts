/**
 * Creates a batch of neutral pilot accounts and writes their access codes to a local CSV.
 *
 *   npm run generate-test-accounts                    # test_001 … test_100, with a starter pathway each
 *   npm run generate-test-accounts -- --count 25 --start 101 --out pilot-b.csv
 *   npm run generate-test-accounts -- --no-pathway
 *
 * Fails closed:
 *  - Refuses if any username in the range already exists.
 *  - Writes the CSV (owner-only permissions) before touching the database, then creates
 *    every account in one transaction. If the transaction fails, the CSV is deleted, so
 *    the file never lists accounts that don't exist.
 *
 * Only HMAC hashes go to the database. The CSV is the only copy of the codes; it is
 * gitignored and should be shared securely and deleted once distributed.
 */
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { hashAccessCode } from "../lib/auth/access-code";
import { formatAccessCode, generateAccessCode } from "../lib/auth/codes";

const STARTER_PATHWAY = "Exploring my next step";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "100" },
    start: { type: "string", default: "1" },
    out: { type: "string", default: "test-access-codes.csv" },
    "no-pathway": { type: "boolean", default: false },
  },
});

const count = Number(values.count);
const start = Number(values.start);
if (!Number.isInteger(count) || count < 1 || count > 1000) fail("--count must be a whole number from 1 to 1000");
if (!Number.isInteger(start) || start < 1) fail("--start must be a whole number of 1 or more");
const out = values.out!;
if (existsSync(out)) fail(`${out} already exists. Move it somewhere safe or choose another --out; it may hold live codes.`);

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL) fail("DATABASE_URL must be set (e.g. in .env.local)");
if (!process.env.ACCESS_CODE_SECRET) fail("ACCESS_CODE_SECRET must be set; codes are hashed with it");

const width = Math.max(3, String(start + count - 1).length);
const usernames = Array.from({ length: count }, (_, i) => `test_${String(start + i).padStart(width, "0")}`);

// Unique within the batch; the database's unique index guards against anything else.
const codes = new Set<string>();
while (codes.size < count) codes.add(generateAccessCode());
const accounts = usernames.map((username, i) => {
  const code = [...codes][i];
  return { username, code, hash: hashAccessCode(code) };
});

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

async function main() {
  const taken = await sql<{ username: string }[]>`select username from users where username = any(${usernames})`;
  if (taken.length) {
    fail(`These usernames already exist: ${taken.map((t) => t.username).join(", ")}. Use --start to pick a free range.`);
  }

  const csv = ["Username,Access Code", ...accounts.map((a) => `${a.username},${formatAccessCode(a.code)}`)].join("\n") + "\n";
  writeFileSync(out, csv, { mode: 0o600 });

  try {
    await sql.begin(async (tx) => {
      const users = await tx<{ id: string }[]>`
        insert into users (username, access_code_hash)
        select * from unnest(${usernames}::text[], ${accounts.map((a) => a.hash)}::text[])
        returning id`;
      if (users.length !== count) throw new Error(`expected ${count} users, created ${users.length}`);
      if (!values["no-pathway"]) {
        await tx`
          insert into pathways (user_id, title, readiness_state, status)
          select id, ${STARTER_PATHWAY}, 'exploring', 'exploratory'
          from unnest(${users.map((u) => u.id)}::uuid[]) as id`;
      }
    });
  } catch (err) {
    rmSync(out, { force: true });
    fail(`No accounts were created (the transaction rolled back): ${(err as Error).message}`);
  }

  console.log(`Created ${count} accounts: ${usernames[0]} … ${usernames[count - 1]}`);
  if (!values["no-pathway"]) console.log(`Each has a starter pathway: "${STARTER_PATHWAY}".`);
  console.log(`Access codes written to ${out} (owner-only). It is the only copy: share it securely, then delete it.`);
}

main()
  .catch((err: Error) => fail(err.message))
  .finally(() => sql.end());
