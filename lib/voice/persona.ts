import { extractFigures, type GroundedClaim } from "@/lib/agents/grounding";

/**
 * The voice layer is PATHWAYS' mouth and ears, never its brain. The brain writes the full,
 * verified reply into the transcript; the voice speaks a short, warm line about it, like a
 * friend who knows the field: a little humor, more listening than talking, and an offer to go
 * through the details. Nothing spoken may carry a figure the verified reply doesn't.
 */

/** What PATHWAYS says when the person taps the mic. The speak route accepts only these, or a reply's stored spoken line. */
export const GREETINGS = [
  "Hey! I'm all ears. What's on your mind?",
  "Hi there. Talk to me. What are we working on today?",
  "Hey, good to hear from you. Where do you want to start?",
] as const;

/** How the voice sounds (OpenAI gpt-4o-mini-tts instructions). */
export const VOICE_STYLE =
  "Warm, relaxed, and encouraging, like a mentor who's also a good friend. Conversational pace, natural pauses, a smile in the voice. Never salesy or formal.";

export const SPOKEN_PROMPT = `You turn a career navigator's written reply into what it says out loud in a voice conversation.
The person is talking, not reading. The full reply is already in their transcript, with sources.

Speak like a trusted friend and mentor who knows Washington's job market: warm, plain, encouraging, with a light touch of humor when it fits. Listen more than you talk.
- One to three short sentences, under 60 words total.
- If they mention something they did or started, celebrate it in a few words first ("A first client? That's huge.").
- Give the gist: the single most useful next step or answer from the reply.
- Then hand the conversation back: ask one short question about them, or offer to go through the details ("Want me to walk you through the details?").
- Mention that the details are in their transcript only when the reply has details worth reading.
- Use only facts in the reply. Don't add or change any number, fee, wage, date, or name.
- No lists, headings, markdown, citations, or URLs. Write numbers the way you'd say them.`;

/** Daily voice allowance per person. */
export const DAILY_LIMITS = { transcribeSeconds: 20 * 60, speakChars: 12_000 } as const;
/** One recording at most. */
export const MAX_RECORDING_SECONDS = 90;
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
export const MAX_SPOKEN_CHARS = 600;

export const FALLBACK_SPOKEN = "I've put the details in our transcript. Want me to walk you through them?";

/**
 * A spoken line is safe to say only if every figure in it appears in the verified claims,
 * the written reply, or the person's own words. Markdown and citations are stripped.
 */
export function checkSpoken(spoken: string, sources: { claims: GroundedClaim[]; reply: string; personText: string[] }): string | null {
  const clean = spoken
    .replace(/\[\d+\]/g, "")
    .replace(/[*_#`>]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
  if (!clean || clean.length > MAX_SPOKEN_CHARS) return null;
  const allowed = new Set(
    [sources.reply, ...sources.personText, ...sources.claims.map((c) => c.statement)].flatMap((t) => extractFigures(t).map((f) => f.key)),
  );
  return extractFigures(clean).every((f) => allowed.has(f.key)) ? clean : null;
}

/** Whether a request to speak `text` is allowed: a greeting, or the stored spoken line it claims to be. */
export function isSpeakable(text: string, storedSpoken: string | null): boolean {
  return (GREETINGS as readonly string[]).includes(text) || (!!storedSpoken && storedSpoken === text);
}

export function remainingToday(usage: { transcribe_seconds: number; speak_chars: number } | null) {
  return {
    transcribeSeconds: Math.max(0, DAILY_LIMITS.transcribeSeconds - (usage?.transcribe_seconds ?? 0)),
    speakChars: Math.max(0, DAILY_LIMITS.speakChars - (usage?.speak_chars ?? 0)),
  };
}
