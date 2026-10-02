/** Field normalizers shared by the Washington connectors. Pure; each throws a readable message on bad input. */

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Builds a lookup that reads a field by any of its accepted header names. */
export function fieldReader(values: Record<string, string>) {
  const byHeader = new Map(Object.entries(values).map(([k, v]) => [normalizeHeader(k), v]));
  return (aliases: readonly string[]): string | null => {
    for (const alias of aliases) {
      const value = byHeader.get(normalizeHeader(alias));
      if (value !== undefined && value.trim() !== "") return value.trim();
    }
    return null;
  };
}

/** Which of a field's accepted names appear in a header row. */
export function hasField(headers: string[], aliases: readonly string[]): boolean {
  const normalized = new Set(headers.map(normalizeHeader));
  return aliases.some((a) => normalized.has(normalizeHeader(a)));
}

export function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[;|\n]|,(?![^(]*\))/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** "$4,250.00" -> 4250. Blank -> null. */
export function parseMoney(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error(`"${value}" is not a dollar amount`);
  return Number(cleaned);
}

/** "62%", "62", or "0.62" -> 0.62. Blank -> null. */
export function parseRate(value: string | null): number | null {
  if (!value) return null;
  const isPercent = value.includes("%");
  const n = Number(value.replace(/[%\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error(`"${value}" is not a rate`);
  const rate = isPercent || n > 1 ? n / 100 : n;
  if (rate > 1) throw new Error(`"${value}" is more than 100%`);
  return Math.round(rate * 10000) / 10000;
}

export function parseInteger(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(cleaned)) throw new Error(`"${value}" is not a whole number`);
  return Number(cleaned);
}

export function parseCoordinate(value: string | null, kind: "latitude" | "longitude"): number | null {
  if (!value) return null;
  const n = Number(value);
  const limit = kind === "latitude" ? 90 : 180;
  if (!Number.isFinite(n) || Math.abs(n) > limit) throw new Error(`"${value}" is not a ${kind}`);
  return n;
}

/** O*NET-SOC codes: "29-1141", "291141", or "29-1141.01" -> "29-1141.00" / "29-1141.01". */
export function normalizeSocCode(value: string): string {
  const m = value.trim().match(/^(\d{2})-?(\d{4})(?:\.(\d{2}))?$/);
  if (!m) throw new Error(`"${value}" is not an O*NET-SOC code`);
  return `${m[1]}-${m[2]}.${m[3] ?? "00"}`;
}

export const WASHINGTON_COUNTIES = [
  "Adams", "Asotin", "Benton", "Chelan", "Clallam", "Clark", "Columbia", "Cowlitz", "Douglas", "Ferry",
  "Franklin", "Garfield", "Grant", "Grays Harbor", "Island", "Jefferson", "King", "Kitsap", "Kittitas",
  "Klickitat", "Lewis", "Lincoln", "Mason", "Okanogan", "Pacific", "Pend Oreille", "Pierce", "San Juan",
  "Skagit", "Skamania", "Snohomish", "Spokane", "Stevens", "Thurston", "Wahkiakum", "Walla Walla",
  "Whatcom", "Whitman", "Yakima",
] as const;

const COUNTY_BY_KEY = new Map(WASHINGTON_COUNTIES.map((c) => [c.toLowerCase(), c]));

/** "pierce county" -> "Pierce". "Statewide" -> all 39 counties. */
export function normalizeCounties(values: string[]): string[] {
  const out = new Set<string>();
  for (const raw of values) {
    const key = raw.toLowerCase().replace(/\bcounty\b/g, "").replace(/\s+/g, " ").trim();
    if (key === "statewide" || key === "all counties" || key === "all") {
      WASHINGTON_COUNTIES.forEach((c) => out.add(c));
      continue;
    }
    const county = COUNTY_BY_KEY.get(key);
    if (!county) throw new Error(`"${raw}" is not a Washington county`);
    out.add(county);
  }
  return [...out];
}

export function normalizeCounty(value: string | null): string | null {
  return value ? normalizeCounties([value])[0] : null;
}

export function parseUrl(value: string | null): string | null {
  if (!value) return null;
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`"${value}" is not a web address`);
  return url.toString();
}
