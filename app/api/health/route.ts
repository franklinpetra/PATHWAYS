import { NextResponse } from "next/server";
import { resolveModels } from "@/lib/ai/openrouter";
import { db } from "@/lib/db/supabase";

export const runtime = "nodejs";

/**
 * Pre-demo health check: the configured models exist on OpenRouter, and the Washington
 * source tables are loaded and current. Reports only names, counts, and dates, never secrets.
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

export async function GET() {
  const results = await Promise.allSettled([
    modelChecks(),
    tableCheck("apprenticeships", STALE_AFTER_DAYS.apprenticeships),
    tableCheck("occupation_wages", STALE_AFTER_DAYS.occupation_wages),
    tableCheck("places"),
    tableCheck("occupations"),
    tableCheck("credentials"),
  ]);
  const checks = results.flatMap((r): Check[] =>
    r.status === "fulfilled" ? (Array.isArray(r.value) ? r.value : [r.value]) : [{ name: "check", ok: false, detail: String(r.reason) }],
  );
  const ok = checks.every((c) => c.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
