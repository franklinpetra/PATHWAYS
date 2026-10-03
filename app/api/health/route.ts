import { NextResponse } from "next/server";
import { resolveModels } from "@/lib/ai/openrouter";
import { SYNC_SOURCES, type SyncSource } from "@/lib/data/washington/sync";
import { db } from "@/lib/db/supabase";

export const runtime = "nodejs";

/**
 * Pre-demo health check: the configured models exist on OpenRouter, the Washington source
 * tables are loaded and current, and each source's latest scheduled refresh succeeded.
 * Reports only names, counts, and dates, never secrets.
 * GET /api/health -> 200 when everything passes, 503 otherwise.
 */

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** Days after a source's as-of date before it counts as stale (L&I updates ARTS monthly). */
const STALE_AFTER_DAYS = { apprenticeships: 45, occupation_wages: 400 } as const;

async function modelChecks(): Promise<Check[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", { cache: "no-store" });
  if (!res.ok) return [{ name: "openrouter", ok: false, detail: `model list returned ${res.status}` }];
  const available = new Set(((await res.json()).data as { id: string }[]).map((m) => m.id));
  return (["PATHWAYS_CHAT_MODEL", "PATHWAYS_STRUCTURED_MODEL"] as const).map((env) => {
    const [primary, ...fallbacks] = resolveModels(undefined, env);
    const configured = process.env[env]?.trim();
    const missing = [primary, ...fallbacks].filter((m) => !available.has(m));
    return {
      name: env,
      ok: configured === primary && available.has(primary),
      detail: `${primary}${available.has(primary) ? "" : " (NOT FOUND on OpenRouter)"}; fallbacks: ${fallbacks.join(", ") || "none"}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`,
    };
  });
}

async function tableCheck(table: string, staleAfterDays?: number): Promise<Check> {
  const { count, error } = await db().from(table).select("*", { count: "exact", head: true });
  if (error) return { name: table, ok: false, detail: error.message };
  if (!count) return { name: table, ok: false, detail: "empty" };
  if (!staleAfterDays) return { name: table, ok: true, detail: `${count} rows` };
  const { data } = await db().from(table).select("source_as_of").order("source_as_of", { ascending: false }).limit(1).single();
  const asOf = (data as { source_as_of?: string } | null)?.source_as_of ?? null;
  const age = asOf ? Math.floor((Date.now() - Date.parse(asOf)) / 86_400_000) : null;
  const stale = age === null || age > staleAfterDays;
  return { name: table, ok: !stale, detail: `${count} rows, as of ${asOf ?? "unknown"}${stale ? ` (stale: refresh with npm run sync)` : ""}` };
}

/** The latest refresh of a source. No run yet is fine (data may have been loaded before scheduling). */
async function syncCheck(source: SyncSource): Promise<Check> {
  const { data, error } = await db()
    .from("data_sync_runs")
    .select("trigger, started_at, finished_at, ok, rows_written, message")
    .eq("source", source)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const name = `sync:${source}`;
  if (error) return { name, ok: false, detail: error.message };
  if (!data) return { name, ok: true, detail: "no refresh recorded yet" };
  const when = `${data.trigger} run ${String(data.started_at).slice(0, 16).replace("T", " ")} UTC`;
  if (data.ok === null) return { name, ok: true, detail: `${when}, still running or interrupted` };
  return data.ok
    ? { name, ok: true, detail: `${when}: ${data.rows_written ?? 0} rows written` }
    : { name, ok: false, detail: `${when} FAILED: ${String(data.message ?? "").slice(0, 300)}` };
}

export async function GET() {
  const results = await Promise.allSettled([
    modelChecks(),
    tableCheck("apprenticeships", STALE_AFTER_DAYS.apprenticeships),
    tableCheck("occupation_wages", STALE_AFTER_DAYS.occupation_wages),
    tableCheck("places"),
    tableCheck("occupations"),
    tableCheck("credentials"),
    ...SYNC_SOURCES.map(syncCheck),
  ]);
  const checks = results.flatMap((r): Check[] =>
    r.status === "fulfilled" ? (Array.isArray(r.value) ? r.value : [r.value]) : [{ name: "check", ok: false, detail: String(r.reason) }],
  );
  const ok = checks.every((c) => c.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
