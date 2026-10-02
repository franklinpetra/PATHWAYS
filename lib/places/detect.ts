/**
 * Finds street addresses and event dates in assistant text so the chat can offer
 * map, handoff, and calendar shortcuts. Pure and client-safe.
 *
 * Detection is deliberately conservative: a missed address costs a shortcut, while
 * a false one puts a wrong pin on a map.
 */

export interface DetectedAddress {
  /** The address exactly as written. */
  text: string;
  /** Search string for map apps; ", WA" is appended when no state was written. */
  query: string;
}

export interface DetectedDate {
  text: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h), or null for an all-day date. */
  time: string | null;
  /** The sentence the date appears in, cleaned of markdown and citations. */
  context: string;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const SUFFIX =
  "(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Way|Lane|Ln|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Circle|Cir|Terrace|Ter|Loop|Square|Sq|Broadway)";
const DIRECTION = "(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West|Northeast|Northwest|Southeast|Southwest)";
const WORD = "(?:[A-Z0-9][A-Za-z0-9'-]*)";
const UNIT = "(?:,?\\s+(?:Suite|Ste\\.?|Unit|Room|Rm\\.?|Bldg\\.?|Building|#)\\s*[A-Za-z0-9-]+)";
const CITY = "(?:[A-Z][A-Za-z.'-]*(?:\\s+[A-Z][A-Za-z.'-]*){0,3})";
const STATE = "(?:WA|Washington)";
const ZIP = "(?:\\s+\\d{5}(?:-\\d{4})?)";
// A city is only captured when a state follows, so "123 Main St, Then..." isn't misread.
const LOCALITY = `(?:,\\s*${CITY}(?:,\\s*|\\s+)${STATE}\\b)?${ZIP}?`;
const NUMBER = "\\b\\d{1,6}(?:-\\d{1,6})?";

/** Number + street name + suffix, e.g. "1000 S 12th St, Tacoma, WA 98405". */
const WITH_SUFFIX = new RegExp(
  `${NUMBER}\\s+(?:${DIRECTION}\\.?\\s+)?(?:${WORD}\\s+){0,4}${SUFFIX}\\b\\.?(?:\\s+${DIRECTION}\\b)?${UNIT}?${LOCALITY}`,
  "g",
);

/** No street suffix, but anchored by city and state, e.g. "1 Pioneer Square, Seattle, WA". */
const WITH_LOCALITY = new RegExp(
  `${NUMBER}\\s+(?:${WORD}\\s+){0,4}${WORD}${UNIT}?,\\s*${CITY}(?:,\\s*|\\s+)${STATE}\\b${ZIP}?`,
  "g",
);

export function detectAddresses(text: string): DetectedAddress[] {
  const matches: { start: number; end: number; text: string }[] = [];
  for (const pattern of [WITH_SUFFIX, WITH_LOCALITY]) {
    for (const m of text.matchAll(pattern)) {
      const value = m[0].replace(/[.,]+$/, "");
      matches.push({ start: m.index, end: m.index + value.length, text: value });
    }
  }

  // Keep the longest match among overlaps.
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof matches = [];
  for (const m of matches) {
    const last = kept[kept.length - 1];
    if (last && m.start < last.end) {
      if (m.end - m.start > last.end - last.start) kept[kept.length - 1] = m;
      continue;
    }
    kept.push(m);
  }

  const seen = new Set<string>();
  return kept.flatMap((m) => {
    const key = m.text.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ text: m.text, query: new RegExp(`\\b${STATE}\\b`).test(m.text) ? m.text : `${m.text}, WA` }];
  });
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_NAME = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const TIME = "(?:\\s*(?:,|at|@|from)?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*([ap])\\.?\\s?m\\.?)?";

const DATE_PATTERNS: { regex: RegExp; parts: (m: RegExpMatchArray) => { y?: number; mo: number; d: number; timeAt: number } }[] = [
  {
    // October 15, 2026 / Oct. 15th / Oct 15 at 3:30 pm
    regex: new RegExp(`\\b(${MONTH_NAME})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b${TIME}`, "gi"),
    parts: (m) => ({ mo: MONTHS[m[1].toLowerCase()], d: Number(m[2]), y: m[3] ? Number(m[3]) : undefined, timeAt: 4 }),
  },
  {
    // 2026-10-15
    regex: new RegExp(`\\b(20\\d{2})-(\\d{2})-(\\d{2})\\b${TIME}`, "g"),
    parts: (m) => ({ y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), timeAt: 4 }),
  },
  {
    // 10/15/2026 or 10/15
    regex: new RegExp(`\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?\\b${TIME}`, "g"),
    parts: (m) => ({
      mo: Number(m[1]),
      d: Number(m[2]),
      y: m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined,
      timeAt: 4,
    }),
  },
];

/** Dates that look like an event rather than, say, a citation's as-of date. */
const EVENT_CUE =
  /\b(deadline|due|apply by|applications? (?:close|open|are due)|closes?|opens?|appointment|interview|orientation|info(?:rmation)? session|open house|tour|meeting|workshop|classes? (?:start|begin)|starts?|begins?|event|fair|visit|registration|register by|enroll(?:ment)? by|priority date)\b/i;
const NON_EVENT_PREFIX = /\b(as of|updated|retrieved|accessed|published|source[sd]?:?)\s*$/i;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isValidDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function sentenceAround(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const boundary = Math.max(before.lastIndexOf("\n"), before.search(/[.!?]\s+[^.!?]*$/) + 1);
  const afterMatch = text.slice(end).search(/[.!?](\s|$)|\n/);
  const stop = afterMatch === -1 ? text.length : end + afterMatch + 1;
  return text
    .slice(Math.max(0, boundary), stop)
    .replace(/\*\*|__|`/g, "")
    .replace(/\[\d+\]/g, "")
    .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Future dates in event-like sentences (or with a time attached). `now` sets "today" in local time. */
export function detectEventDates(text: string, now: Date = new Date()): DetectedDate[] {
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const found: (DetectedDate & { start: number })[] = [];

  for (const { regex, parts } of DATE_PATTERNS) {
    for (const m of text.matchAll(regex)) {
      const start = m.index;
      if (found.some((f) => start >= f.start && start < f.start + f.text.length)) continue;
      if (NON_EVENT_PREFIX.test(text.slice(Math.max(0, start - 16), start))) continue;

      const p = parts(m);
      let year = p.y ?? now.getFullYear();
      if (!isValidDate(year, p.mo, p.d)) continue;
      let date = `${year}-${pad(p.mo)}-${pad(p.d)}`;
      if (p.y === undefined && date < today) {
        year += 1;
        if (!isValidDate(year, p.mo, p.d)) continue;
        date = `${year}-${pad(p.mo)}-${pad(p.d)}`;
      }
      if (date < today) continue;

      let time: string | null = null;
      if (m[p.timeAt]) {
        let hour = Number(m[p.timeAt]);
        const minute = Number(m[p.timeAt + 1] ?? 0);
        const pm = m[p.timeAt + 2].toLowerCase() === "p";
        if (hour >= 1 && hour <= 12 && minute < 60) {
          if (pm && hour !== 12) hour += 12;
          if (!pm && hour === 12) hour = 0;
          time = `${pad(hour)}:${pad(minute)}`;
        }
      }

      const context = sentenceAround(text, start, start + m[0].length);
      if (!time && !EVENT_CUE.test(context)) continue;
      found.push({ text: m[0].trim(), date, time, context, start });
    }
  }

  return found.sort((a, b) => a.start - b.start).map(({ start: _start, ...rest }) => rest);
}
