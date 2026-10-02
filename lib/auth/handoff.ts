import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db/supabase";

/**
 * Single-use, short-lived links that continue a signed-in session on another
 * device (desktop QR code -> phone). Only a SHA-256 of the token is stored.
 */

const TTL_MINUTES = 10;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isSafeTargetPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}

export async function createHandoffToken(
  userId: string,
  targetPath: string,
): Promise<{ token: string; expiresAt: string }> {
  if (!isSafeTargetPath(targetPath)) throw new Error("Handoff target must be a relative path");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000).toISOString();
  const { error } = await db()
    .from("handoff_tokens")
    .insert({ user_id: userId, token_hash: hashToken(token), target_path: targetPath, expires_at: expiresAt });
  if (error) throw new Error(`Failed to create handoff: ${error.message}`);
  return { token, expiresAt };
}

/** Atomically marks the token used; returns null if it is unknown, expired, or already used. */
export async function redeemHandoffToken(token: string): Promise<{ userId: string; targetPath: string } | null> {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("handoff_tokens")
    .update({ used_at: now })
    .eq("token_hash", hashToken(token))
    .is("used_at", null)
    .gt("expires_at", now)
    .select("user_id, target_path")
    .maybeSingle();
  if (error || !data) return null;
  return { userId: data.user_id, targetPath: data.target_path };
}
