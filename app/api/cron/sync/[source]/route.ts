import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { SYNC_SOURCES, runSync, type SyncSource } from "@/lib/data/washington/sync";
import { db } from "@/lib/db/supabase";

export const runtime = "nodejs";
// The wage data book is a few MB of spreadsheet; give downloads and upserts room.
export const maxDuration = 300;

/**
 * Scheduled refresh of one Washington source, invoked by Vercel Cron (see vercel.json).
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET configured, every
 * request is refused. Each run is recorded in data_sync_runs, which /api/health reads.
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/cron/sync/[source]">) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const { source } = await ctx.params;
  if (!SYNC_SOURCES.includes(source as SyncSource)) return new Response("Unknown source", { status: 404 });

  try {
    const result = await runSync(db(), source as SyncSource, "cron");
    console.log(`[cron] ${source} sync: wrote ${result.written}, removed ${result.removed}, as of ${result.asOf ?? "n/a"}`);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error(`[cron] ${source} sync failed`, err);
    return Response.json({ ok: false, source, error: (err as Error).message }, { status: 500 });
  }
}
