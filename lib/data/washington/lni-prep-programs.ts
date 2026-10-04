import { normalizeCounty, parseUrl } from "./fields";
import type { SourceStamp } from "./sources";

/**
 * L&I's list of Recognized Apprenticeship Preparation Programs (pre-apprenticeships that hold
 * formal articulation agreements with registered apprenticeship sponsors), parsed from the
 * official page. Each program is one paragraph: a bold name, then address, contact, phone,
 * email, website, and optional notes. Audiences and fields are tagged from the program's own
 * name and notes by fixed keyword rules, for matching only; they are never stated as facts.
 */

export const LNI_PREP_PAGE = "https://lni.wa.gov/licensing-permits/apprenticeship/become-apprentice/apprenticeship-preparation";
const LIST_HEADING = /<h3>\s*List of apprenticeship preparation programs\s*<\/h3>/i;

export interface SteppingStoneRow extends SourceStamp {
  source_record_id: string;
  kind: "pre_apprenticeship" | "returnship" | "transitional_employment" | "paid_training" | "job_training" | "support_service" | "second_chance_employer" | "staffing_agency";
  name: string;
  organization: string | null;
  summary: string | null;
  audiences: string[];
  fields: string[];
  paid: boolean | null;
  open_enrollment: boolean;
  street_address: string | null;
  city: string | null;
  county: string | null;
  state: "WA";
  postal_code: string | null;
  statewide: boolean;
  latitude?: number | null;
  longitude?: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
  provenance: "official" | "program";
}

const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", ndash: "–", mdash: "—", rsquo: "’" };

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const stripTags = (html: string) => decode(html.replace(/<[^>]+>/g, " "));

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Keyword rules over a program's name and notes. Order doesn't matter; tags accumulate. */
const AUDIENCE_RULES: [RegExp, string][] = [
  [/\bwomen\b/i, "women"],
  [/\byouth\b|high school|public schools?\b|skills center|\bschool district|ages 1[4-9]|GED students/i, "youth"],
  [/\bveteran|military/i, "veterans"],
  [/\bDOC\b|correction|reentry|re-entry|incarcerat/i, "returning_citizens"],
  [/\btribe|tribal|nation\b|\bTERO\b/i, "tribal_members"],
];

const FIELD_RULES: [RegExp, string][] = [
  [/construction|trades|carpent|ironwork|laborer|electric|plumb|pipe|HVAC|sheet metal|cement|mason|weld|building industry|roof|\bABC\b|builders|contractors/i, "construction"],
  [/manufactur|machinist|aerospace|weld|\bAJAC\b/i, "manufacturing"],
  [/health|medical|nursing/i, "healthcare"],
  [/comput|software|\btech(nology)?\b|\bIT\b|cyber|security/i, "technology"],
  [/energy|power|electrical|solar/i, "energy"],
  [/water|utilit/i, "utilities"],
  [/maritime|marine|boat|waterfront/i, "maritime"],
  [/culinary|cook|kitchen|food/i, "culinary"],
];

export function tag(text: string, rules: [RegExp, string][]): string[] {
  return [...new Set(rules.filter(([re]) => re.test(text)).map(([, t]) => t))].sort();
}

/** Programs from the official page, or an error when the page no longer has the expected list. */
export function parseLniPrepPrograms(html: string, stamp: SourceStamp): { rows: SteppingStoneRow[]; skipped: string[] } {
  const start = html.search(LIST_HEADING);
  if (start < 0) throw new Error("L&I's page no longer has the 'List of apprenticeship preparation programs' heading; check the page.");
  const section = html.slice(start, html.indexOf("</div>", start) > 0 ? html.indexOf("</div>", start) : undefined);

  const rows: SteppingStoneRow[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const [, inner] of section.matchAll(/<p>\s*<strong>([\s\S]*?)<\/p>/gi)) {
    const [nameHtml, ...restParts] = inner.split(/<\/strong>/i);
    const name = stripTags(nameHtml);
    if (!name) continue;
    const body = restParts.join(" ");
    const lines = body
      .split(/<br\s*\/?>/i)
      .map((l) => ({ text: stripTags(l), href: l.match(/href="([^"]+)"/i)?.[1] ?? null }))
      .filter((l) => l.text);
    const field = (label: string) => lines.find((l) => l.text.toLowerCase().startsWith(`${label.toLowerCase()}:`));
    const value = (label: string) => field(label)?.text.replace(/^[^:]+:\s*/, "").trim() || null;

    // The physical address is everything before the first labeled line.
    const firstLabeled = lines.findIndex((l) => /^[A-Za-z ]+:/.test(l.text));
    const addressLines = (firstLabeled < 0 ? lines : lines.slice(0, firstLabeled)).map((l) => l.text);
    const cityLine = addressLines.map((l) => l.match(/^(.+?),\s*WA\s+(\d{5})(?:-\d{4})?$/)).find(Boolean) ?? null;
    const cityIndex = cityLine ? addressLines.findIndex((l) => l === cityLine[0]) : -1;
    const street = cityIndex > 0 ? addressLines[cityIndex - 1] : null;
    const organization = cityIndex > 1 ? addressLines.slice(0, cityIndex - 1).join("; ") : null;

    const website = field("Website");
    const email = value("Email");
    let county: string | null = null;
    try {
      county = normalizeCounty(value("County"));
    } catch {
      county = null;
    }
    const summary = value("Additional information");
    const id = slug(name);
    if (seen.has(id)) {
      skipped.push(`${name}: listed twice`);
      continue;
    }
    seen.add(id);

    const text = `${name} ${organization ?? ""} ${summary ?? ""}`;
    rows.push({
      ...stamp,
      source_record_id: id,
      kind: "pre_apprenticeship",
      name,
      organization,
      summary,
      audiences: tag(text, AUDIENCE_RULES),
      fields: tag(text, FIELD_RULES),
      paid: null,
      open_enrollment: !/not open for public enrollment/i.test(body),
      street_address: street,
      city: cityLine?.[1].trim() ?? null,
      county,
      state: "WA",
      postal_code: cityLine?.[2] ?? null,
      statewide: false,
      contact_name: value("Contact"),
      contact_phone: value("Phone"),
      contact_email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      website: safeUrl(website?.href ?? website?.text.replace(/^[^:]+:\s*/, "") ?? null),
      provenance: "official",
    });
  }
  return { rows, skipped };
}

function safeUrl(value: string | null): string | null {
  try {
    return parseUrl(value);
  } catch {
    return null;
  }
}
