import { z } from "zod";
import { normalizeText } from "@/lib/agents/official-sources";
import type { SteppingStoneRow } from "./lni-prep-programs";

/**
 * Curated stepping-stone programs (returnships, transitional employment, paid-to-learn, and
 * supported job training) that publish no data feed. Each comes from a packet a person has
 * reviewed (data/stepping-stones/*.json), and on every sync each program's quotes are re-checked
 * against its live page: a program loads only while every quote is still there word for word.
 */

export const CURATED_PREFIX = "curated:";

const packetSchema = z.object({
  status: z.enum(["draft", "reviewed"]),
  review: z.object({ reviewed_by: z.string().nullable(), reviewed_on: z.string().nullable(), notes: z.array(z.string()) }),
  programs: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      kind: z.enum([
        "pre_apprenticeship",
        "returnship",
        "transitional_employment",
        "paid_training",
        "job_training",
        "support_service",
        "second_chance_employer",
      ]),
      name: z.string().min(1),
      organization: z.string().nullable(),
      summary: z.string().min(1),
      audiences: z.array(z.string()),
      fields: z.array(z.string()),
      paid: z.boolean().nullable(),
      city: z.string().nullable(),
      statewide: z.boolean(),
      website: z.url().nullable(),
      source: z.object({ name: z.string().min(1), url: z.url(), authority: z.string().min(1) }),
      // A quote is from the program's source page, or from another page named with it.
      quotes: z.array(z.union([z.string().min(20), z.object({ url: z.url(), text: z.string().min(20) })])).min(1),
    }),
  ),
});

export type CuratedPacket = z.infer<typeof packetSchema>;

/** Visible text of an HTML page, for quote checks. */
export function pageText(html: string): string {
  return normalizeText(
    html
      .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&rsquo;|&#8217;/g, "’")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"'),
  );
}

export async function curatedRows(
  raw: unknown,
  fetchPage: (url: string) => Promise<string>,
  today: string,
): Promise<{ rows: SteppingStoneRow[]; notes: string[] }> {
  const packet = packetSchema.parse(raw);
  if (packet.status !== "reviewed" || !packet.review.reviewed_by || !packet.review.reviewed_on) {
    return { rows: [], notes: [`Curated packet is a draft (${packet.programs.length} programs await review); none loaded.`] };
  }

  const rows: SteppingStoneRow[] = [];
  const notes: string[] = [];
  for (const p of packet.programs) {
    const quotes = p.quotes.map((q) => (typeof q === "string" ? { url: p.source.url, text: q } : q));
    const pages = new Map<string, string>();
    let unreadable: string | null = null;
    for (const url of new Set(quotes.map((q) => q.url))) {
      try {
        pages.set(url, pageText(await fetchPage(url)));
      } catch (err) {
        unreadable = `${url} (${(err as Error).message})`;
        break;
      }
    }
    if (unreadable) {
      notes.push(`${p.name}: couldn't read ${unreadable}; skipped.`);
      continue;
    }
    const missing = quotes.filter((q) => !pages.get(q.url)!.includes(normalizeText(q.text)));
    if (missing.length) {
      notes.push(`${p.name}: ${missing.length} quote(s) no longer on ${[...new Set(missing.map((q) => q.url))].join(", ")}; skipped until re-reviewed.`);
      continue;
    }
    const official = /\.wa\.gov$|\.gov$/.test(new URL(p.source.url).hostname);
    rows.push({
      source_name: p.source.name,
      verification_authority: p.source.authority,
      source_url: p.source.url,
      source_as_of: today,
      observation_period: null,
      source_record_id: `${CURATED_PREFIX}${p.id}`,
      kind: p.kind,
      name: p.name,
      organization: p.organization,
      summary: p.summary,
      audiences: p.audiences,
      fields: p.fields,
      paid: p.paid,
      open_enrollment: true,
      street_address: null,
      city: p.city,
      county: null,
      state: "WA",
      postal_code: null,
      statewide: p.statewide,
      contact_name: null,
      contact_phone: null,
      contact_email: null,
      website: p.website,
      provenance: official ? "official" : "program",
    });
  }
  return { rows, notes };
}
