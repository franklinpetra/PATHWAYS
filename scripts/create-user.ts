/**
 * Creates a person with a fresh access code, plus an optional starter pathway.
 *
 *   npm run create-user -- --username dana [--email dana@example.org] [--pathway "Exploring healthcare"]
 *
 * The code is printed once and never stored: only its HMAC (keyed by ACCESS_CODE_SECRET) is saved.
 * Codes use an unambiguous alphabet (no 0/O, 1/I/L) and are grouped for reading; sign-in ignores
 * spaces and case.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { hashAccessCode } from "../lib/auth/access-code";
import { formatAccessCode, generateAccessCode } from "../lib/auth/codes";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    username: { type: "string" },
    email: { type: "string" },
    pathway: { type: "string" },
  },
});

const username = values.username?.trim();
if (!username) fail("--username is required");
if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) fail("--email is not an email address");

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: existing, error: lookupError } = await db.from("users").select("id").eq("username", username).maybeSingle();
  if (lookupError) fail(`Couldn't check username: ${lookupError.message}`);
  if (existing) fail(`Username "${username}" is taken.`);

  // A collision is astronomically unlikely, but the hash is unique, so retry rather than fail.
  let code = "";
  let userId = "";
  for (let attempt = 0; attempt < 3 && !userId; attempt++) {
    code = generateAccessCode();
    const { data, error } = await db
      .from("users")
      .insert({ username, email: values.email ?? null, access_code_hash: hashAccessCode(code) })
      .select("id")
      .single();
    if (data) userId = data.id;
    else if (error && !error.message.includes("users_access_code_hash_unique")) fail(`Couldn't create user: ${error.message}`);
  }
  if (!userId) fail("Couldn't generate a unique access code. Try again.");

  let pathwayId: string | null = null;
  if (values.pathway?.trim()) {
    const { data, error } = await db
      .from("pathways")
      .insert({ user_id: userId, title: values.pathway.trim(), readiness_state: "exploring", status: "exploratory" })
      .select("id")
      .single();
    if (error) fail(`User created, but the pathway failed: ${error.message}`);
    pathwayId = data.id;
  }

  console.log(`\nCreated ${username}.`);
  console.log(`  Access code: ${formatAccessCode(code)}   (shown once; store it somewhere safe)`);
  if (pathwayId) console.log(`  Pathway: /pathways/${pathwayId}`);
}

main().catch((err: Error) => fail(err.message));
