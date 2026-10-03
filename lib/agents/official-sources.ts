import { z } from "zod";
import type { SourceAttribution } from "@/lib/workspace/events";

/**
 * Live lookup on official sources.
 *
 * The Fact-Finder may search the web, but only these domains, and every fact it returns
 * must carry a verbatim quote from a page the search actually retrieved. Verification is
 * deterministic and fails closed: a fact is dropped unless its URL is on an allowed domain
 * and among the retrieved pages, its quote appears in that page's text, and every number in
 * its statement also appears in the quote. The claim the reply sees includes the quote itself.
 */

/** Allowed domains, most specific first: a host matches the first entry it equals or ends with. */
export const OFFICIAL_SOURCES: readonly { domain: string; authority: string }[] = [
  { domain: "doh.wa.gov", authority: "Washington State Department of Health" },
  { domain: "leg.wa.gov", authority: "Washington State Legislature" },
  { domain: "lni.wa.gov", authority: "Washington State Department of Labor & Industries" },
  { domain: "esd.wa.gov", authority: "Washington State Employment Security Department" },
  { domain: "dor.wa.gov", authority: "Washington State Department of Revenue" },
  { domain: "sos.wa.gov", authority: "Washington Secretary of State" },
  { domain: "dol.wa.gov", authority: "Washington State Department of Licensing" },
  { domain: "careerbridge.wa.gov", authority: "Washington Workforce Training and Education Coordinating Board" },
  { domain: "wtb.wa.gov", authority: "Washington Workforce Training and Education Coordinating Board" },
  { domain: "wsac.wa.gov", authority: "Washington Student Achievement Council" },
  { domain: "wa.gov", authority: "State of Washington" },
  { domain: "sbctc.edu", authority: "Washington State Board for Community and Technical Colleges" },
  { domain: "washington.edu", authority: "University of Washington" },
  { domain: "wsu.edu", authority: "Washington State University" },
  { domain: "kingcounty.gov", authority: "King County" },
  { domain: "tpchd.org", authority: "Tacoma-Pierce County Health Department" },
  { domain: "srhd.org", authority: "Spokane Regional Health District" },
  { domain: "snohd.org", authority: "Snohomish County Health Department" },
  { domain: "seattle.gov", authority: "City of Seattle" },
  { domain: "cityoftacoma.org", authority: "City of Tacoma" },
  { domain: "my.spokanecity.org", authority: "City of Spokane" },
  { domain: "apprenticeship.gov", authority: "U.S. Department of Labor" },
  { domain: "dol.gov", authority: "U.S. Department of Labor" },
  { domain: "bls.gov", authority: "U.S. Bureau of Labor Statistics" },
  { domain: "onetonline.org", authority: "U.S. Department of Labor, Employment and Training Administration" },
  { domain: "careeronestop.org", authority: "U.S. Department of Labor, Employment and Training Administration" },
  { domain: "sba.gov", authority: "U.S. Small Business Administration" },
  { domain: "irs.gov", authority: "Internal Revenue Service" },
];

export function authorityFor(url: string): string | null {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  return OFFICIAL_SOURCES.find(({ domain }) => host === domain || host.endsWith(`.${domain}`))?.authority ?? null;
}

export const officialFactsSchema = z.object({
  facts: z.array(
    z.object({
      statement: z.string().describe("One fact in plain words, answering part of the question."),
      source_url: z.string().describe("The exact URL of the search result the fact comes from."),
      quote: z.string().describe("A passage copied character for character from that page that states the fact."),
    }),
  ),
});

export type OfficialFact = z.infer<typeof officialFactsSchema>["facts"][number];

export const OFFICIAL_FACTS_PROMPT = `You extract facts from official Washington State and U.S. government and public university web pages.
Using only the search results, list up to 8 facts that answer the question: requirements, steps, eligibility, fees, hours, exams, permits, forms, and which office handles what.
For each fact, give the exact URL of the result it comes from and a quote copied character for character from that page that states it. Never paraphrase inside a quote.
The statement must not add anything the quote doesn't say, including any number.
If the results don't answer the question, return an empty list.`;

export interface PageText {
  url: string;
  title: string | null;
  content: string;
}

export interface OfficialClaim {
  id: string;
  kind: "official";
  statement: string;
  source: SourceAttribution;
}

const MIN_QUOTE_LENGTH = 20;
const MAX_QUOTE_LENGTH = 600;

/** Lowercase, straight quotes, plain hyphens, single spaces: so a faithful copy still matches. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

function numbers(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ""));
}

/** Facts that pass every check, as claims; the rest are counted, never shown. */
export function verifyOfficialFacts(
  facts: OfficialFact[],
  pages: PageText[],
  today: string,
): { claims: OfficialClaim[]; dropped: number } {
  const byUrl = new Map(pages.map((p) => [normalizeUrl(p.url), p]));
  const claims: OfficialClaim[] = [];
  const seen = new Set<string>();

  for (const fact of facts) {
    const authority = authorityFor(fact.source_url);
    const page = byUrl.get(normalizeUrl(fact.source_url));
    const quote = normalizeText(fact.quote);
    const statement = fact.statement.trim();
    const quoteNumbers = new Set(numbers(quote));
    const ok =
      authority !== null &&
      page !== undefined &&
      quote.length >= MIN_QUOTE_LENGTH &&
      quote.length <= MAX_QUOTE_LENGTH &&
      normalizeText(page.content).includes(quote) &&
      statement.length > 0 &&
      numbers(statement).every((n) => quoteNumbers.has(n)) &&
      !seen.has(quote);
    if (!ok) continue;
    seen.add(quote);
    claims.push({
      id: `official:${normalizeUrl(fact.source_url)}#${claims.length + 1}`,
      kind: "official",
      statement: `${statement} (Source text: "${fact.quote.trim().replace(/\s+/g, " ")}")`,
      source: {
        name: page.title?.trim() || new URL(fact.source_url).hostname,
        observationPeriod: null,
        asOf: today,
        verificationAuthority: authority,
        url: fact.source_url,
      },
    });
  }

  return { claims, dropped: facts.length - claims.length };
}
