import { describe, expect, it } from "vitest";
import { detectAddresses, detectEventDates } from "@/lib/places/detect";
import { buildIcs, detectPlatform, mapsUrl } from "@/lib/places/links";

describe("detectAddresses", () => {
  it.each([
    ["Visit 1000 S 12th St, Tacoma, WA 98405 for the lab.", "1000 S 12th St, Tacoma, WA 98405"],
    ["The campus is at 1701 Broadway, Seattle, WA 98122.", "1701 Broadway, Seattle, WA 98122"],
    ["Admissions is in 2120 S 48th Street, Suite 100.", "2120 S 48th Street, Suite 100"],
    ["Try 400 15th Ave NE next.", "400 15th Ave NE"],
    ["Meet at 1 Pioneer Square, Seattle, WA.", "1 Pioneer Square, Seattle, WA"],
  ])("finds the address in %j", (text, expected) => {
    expect(detectAddresses(text).map((a) => a.text)).toEqual([expected]);
  });

  it("adds the state to map queries when it wasn't written", () => {
    expect(detectAddresses("Go to 600 4th Ave tomorrow.")[0].query).toBe("600 4th Ave, WA");
  });

  it("does not stop the city at a capitalized next sentence", () => {
    expect(detectAddresses("It's at 123 Main St, Then ask for Dana.")[0].text).toBe("123 Main St");
  });

  it.each([
    "Most programs take 2 years to finish.",
    "About 25 students per cohort.",
    "Call 253-555-0100 for details.",
    "There are 3 Ways to apply.",
  ])("ignores %j", (text) => {
    expect(detectAddresses(text)).toEqual([]);
  });

  it("dedupes repeated addresses", () => {
    expect(detectAddresses("1701 Broadway, Seattle, WA. Again: 1701 Broadway, Seattle, WA.")).toHaveLength(1);
  });
});

describe("detectEventDates", () => {
  const now = new Date(2026, 9, 1, 9, 0); // Oct 1 2026, local time

  it("finds a deadline with a month name", () => {
    expect(detectEventDates("The application deadline is November 15, 2026.", now)).toEqual([
      expect.objectContaining({ date: "2026-11-15", time: null, context: "The application deadline is November 15, 2026." }),
    ]);
  });

  it("parses times and infers next year for past month/day", () => {
    const [d] = detectEventDates("Info session: Jan 8 at 6:30 pm in the library.", now);
    expect(d).toMatchObject({ date: "2027-01-08", time: "18:30" });
  });

  it("accepts numeric and ISO dates in event sentences", () => {
    expect(detectEventDates("Orientation starts 10/20.", now)[0].date).toBe("2026-10-20");
    expect(detectEventDates("Registration closes 2026-12-01.", now)[0].date).toBe("2026-12-01");
  });

  it("ignores citation as-of dates, past dates, and dates without an event cue", () => {
    expect(detectEventDates("Source: SBCTC, as of 2026-11-01. [1]", now)).toEqual([]);
    expect(detectEventDates("The deadline was September 1, 2026.", now)).toEqual([]);
    expect(detectEventDates("The program was redesigned on December 3, 2026.", now)).toEqual([]);
  });

  it("rejects impossible dates", () => {
    expect(detectEventDates("Applications are due February 30, 2027.", now)).toEqual([]);
  });

  it("strips markdown and citations from the context", () => {
    expect(detectEventDates("- **Apply by** Nov 1, 2026 [2]", now)[0].context).toBe("Apply by Nov 1, 2026");
  });
});

describe("links", () => {
  it("detects platforms, including iPadOS posing as a Mac", () => {
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14)")).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("other");
  });

  it("builds a map intent per platform", () => {
    const target = { query: "1701 Broadway, Seattle, WA", latitude: 47.6, longitude: -122.3 };
    expect(mapsUrl(target, "android")).toBe("geo:47.6,-122.3?q=1701%20Broadway%2C%20Seattle%2C%20WA");
    expect(mapsUrl({ query: "x" }, "android")).toBe("geo:0,0?q=x");
    expect(mapsUrl(target, "ios")).toContain("https://maps.apple.com/?q=1701");
    expect(mapsUrl(target, "other")).toBe("https://www.google.com/maps/search/?api=1&query=1701%20Broadway%2C%20Seattle%2C%20WA");
  });

  it("builds an all-day .ics with escaped text and CRLF lines", () => {
    const ics = buildIcs({
      title: "Apply by Nov 1; bring transcripts, ID",
      date: "2026-11-01",
      time: null,
      location: "1701 Broadway, Seattle, WA",
      uid: "abc@pathways",
      now: new Date("2026-10-01T00:00:00Z"),
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102");
    expect(ics).toContain("SUMMARY:Apply by Nov 1\\; bring transcripts\\, ID");
    expect(ics).toContain("DTSTAMP:20261001T000000Z");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it("builds a timed .ics in floating local time", () => {
    const ics = buildIcs({ title: "Info session", date: "2027-01-08", time: "18:30", uid: "x" });
    expect(ics).toContain("DTSTART:20270108T183000\r\nDTEND:20270108T193000");
  });

  it("folds long lines", () => {
    const ics = buildIcs({ title: "x".repeat(200), date: "2027-01-08", time: null, uid: "x" });
    expect(ics).toContain("\r\n x");
  });
});
