/** Map intents and calendar files for the message toolbar. Pure and client-safe. */

export type Platform = "ios" | "android" | "other";

export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/android/i.test(userAgent)) return "android";
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)) return "ios";
  return "other";
}

export interface MapTarget {
  query: string;
  latitude?: number | null;
  longitude?: number | null;
}

export function mapsUrl(target: MapTarget, platform: Platform): string {
  const q = encodeURIComponent(target.query);
  const hasCoords = target.latitude != null && target.longitude != null;
  switch (platform) {
    case "android":
      // geo: intent opens the person's default maps app.
      return hasCoords ? `geo:${target.latitude},${target.longitude}?q=${q}` : `geo:0,0?q=${q}`;
    case "ios":
      return `https://maps.apple.com/?q=${q}${hasCoords ? `&ll=${target.latitude},${target.longitude}` : ""}`;
    default:
      return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }
}

export interface CalendarEvent {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h) in the person's local time, or null for all day. */
  time: string | null;
  location?: string | null;
  description?: string | null;
  uid: string;
  now?: Date;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 folding: lines longer than 75 octets continue on the next line after a space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const charSize = new TextEncoder().encode(char).length;
    if (size + charSize > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += charSize;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function compactDate(date: string): string {
  return date.replace(/-/g, "");
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Builds an .ics file. Timed events use floating local time so they land at the stated hour wherever the person is. */
export function buildIcs(event: CalendarEvent): string {
  let start: string;
  let end: string;
  if (event.time) {
    const [h, m] = event.time.split(":").map(Number);
    const endHour = Math.min(h + 1, 23);
    const endMinute = h + 1 > 23 ? 59 : m;
    start = `DTSTART:${compactDate(event.date)}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
    end = `DTEND:${compactDate(event.date)}T${String(endHour).padStart(2, "0")}${String(endMinute).padStart(2, "0")}00`;
  } else {
    start = `DTSTART;VALUE=DATE:${compactDate(event.date)}`;
    end = `DTEND;VALUE=DATE:${compactDate(nextDay(event.date))}`;
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pathways//Workspace//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(event.now ?? new Date())}`,
    start,
    end,
    `SUMMARY:${escapeText(event.title)}`,
    event.location ? `LOCATION:${escapeText(event.location)}` : null,
    event.description ? `DESCRIPTION:${escapeText(event.description)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);

  return lines.map(fold).join("\r\n") + "\r\n";
}
