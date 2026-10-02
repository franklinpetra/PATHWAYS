import "server-only";
import { createHmac } from "node:crypto";

/**
 * Access codes are credentials: only a keyed hash is stored (users.access_code_hash).
 *
 * HMAC-SHA256 with a system-wide secret is deterministic, so a person can sign in
 * with their code alone (lookup by hash), while a leaked database is useless
 * without ACCESS_CODE_SECRET. Rotating the secret invalidates every stored hash.
 */

function secret(): string {
  const value = process.env.ACCESS_CODE_SECRET;
  if (!value || value.length < 32) {
    throw new Error("ACCESS_CODE_SECRET must be set to at least 32 characters");
  }
  return value;
}

/** Codes are case- and whitespace-insensitive so "ab12 cd34" matches "AB12CD34". */
export function normalizeAccessCode(code: string): string {
  return code.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

export function hashAccessCode(code: string): string {
  return createHmac("sha256", secret()).update(normalizeAccessCode(code)).digest("hex");
}
