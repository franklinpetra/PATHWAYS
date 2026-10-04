import { describe, expect, it } from "vitest";
import { DAILY_LIMITS, GREETINGS, checkSpoken, isSpeakable, remainingToday } from "@/lib/voice/persona";
import { guardMessage, type GuardState } from "@/lib/validation/state-guard";
import type { Pathway } from "@/lib/db/types";

const claim = { statement: "Plumber apprenticeship. Starting apprentice wage: $21.86 per hour.", source: { name: "ARTS", observationPeriod: null, asOf: "2026-10-01", verificationAuthority: "L&I", url: "https://data.wa.gov/d/x" } };
const reply = "Start with a registered plumbing apprenticeship. It starts at $21.86 per hour [1].";

describe("checkSpoken", () => {
  it("keeps a warm line whose figures come from the verified reply, minus markdown and citations", () => {
    expect(checkSpoken("**Good news:** apprentices start around $21.86 an hour [1]. Want the details?", { claims: [claim], reply, personText: [] })).toBe(
      "Good news: apprentices start around $21.86 an hour. Want the details?",
    );
  });

  it("refuses a line that adds a figure the reply never stated", () => {
    expect(checkSpoken("You could be making $95,000 within a year!", { claims: [claim], reply, personText: [] })).toBeNull();
  });

  it("allows the person's own numbers", () => {
    expect(checkSpoken("With $5,000 rent, let's aim high.", { claims: [], reply: "", personText: ["my rent is $5,000"] })).not.toBeNull();
  });

  it("refuses empty or overlong lines", () => {
    expect(checkSpoken("   ", { claims: [], reply: "", personText: [] })).toBeNull();
    expect(checkSpoken("a ".repeat(400), { claims: [], reply: "", personText: [] })).toBeNull();
  });
});

describe("isSpeakable", () => {
  it("speaks only greetings or the exact stored spoken line", () => {
    expect(isSpeakable(GREETINGS[0], null)).toBe(true);
    expect(isSpeakable("Hello", "Hello")).toBe(true);
    expect(isSpeakable("Say anything I want", null)).toBe(false);
    expect(isSpeakable("Say anything I want", "Something else")).toBe(false);
  });
});

describe("remainingToday", () => {
  it("counts down from the daily limits and never goes negative", () => {
    expect(remainingToday(null)).toEqual({ transcribeSeconds: DAILY_LIMITS.transcribeSeconds, speakChars: DAILY_LIMITS.speakChars });
    expect(remainingToday({ transcribe_seconds: 100_000, speak_chars: 50 }).transcribeSeconds).toBe(0);
  });
});

describe("guardMessage with voice", () => {
  const PATHWAY = "00000000-0000-4000-8000-0000000000a1";
  const state: GuardState = {
    userId: "00000000-0000-4000-8000-000000000001",
    contextItems: [],
    archivedContextItems: [],
    pathways: [{ id: PATHWAY } as Pathway],
    actions: [],
    progressEvents: [],
  };

  it("stores a spoken line on a reply and a voice flag on the person's message", () => {
    const reply = guardMessage(state, { role: "assistant", content: "Full reply.", pathwayId: PATHWAY, spoken: "Short line." });
    expect(reply.mutations[0]).toMatchObject({ op: "insert_message", row: { spoken: "Short line.", via_voice: false } });
    const said = guardMessage(state, { role: "user", content: "I said this.", pathwayId: PATHWAY, viaVoice: true });
    expect(said.mutations[0]).toMatchObject({ row: { via_voice: true, spoken: null } });
  });

  it("refuses a spoken line on the person's message, and a voice flag on a reply", () => {
    expect(guardMessage(state, { role: "user", content: "Hi", pathwayId: PATHWAY, spoken: "x" }).rejections).toHaveLength(1);
    expect(guardMessage(state, { role: "assistant", content: "Hi", pathwayId: PATHWAY, viaVoice: true }).rejections).toHaveLength(1);
  });
});
