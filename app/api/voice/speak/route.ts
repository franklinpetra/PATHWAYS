import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { addVoiceUsage, getPathway, getVoiceUsage, isStoredSpokenLine } from "@/lib/db/queries";
import { speak } from "@/lib/voice/openai";
import { GREETINGS, MAX_SPOKEN_CHARS, isSpeakable, remainingToday } from "@/lib/voice/persona";

export const runtime = "nodejs";

const bodySchema = z.object({ pathwayId: z.uuid(), text: z.string().trim().min(1).max(MAX_SPOKEN_CHARS) });

/**
 * POST /api/voice/speak  { pathwayId, text } -> audio/mpeg
 *
 * Speaks a greeting, or the exact spoken line stored with one of this person's replies.
 * Nothing else can be voiced, so the endpoint can't be used to read arbitrary text.
 */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { pathwayId, text } = body.data;

  if (!(await getPathway(userId, pathwayId))) return NextResponse.json({ error: "Pathway not found." }, { status: 404 });
  const greeting = (GREETINGS as readonly string[]).includes(text);
  const stored = greeting ? false : await isStoredSpokenLine(userId, pathwayId, text);
  if (!isSpeakable(text, stored ? text : null)) return NextResponse.json({ error: "Nothing to say for that." }, { status: 403 });

  if (remainingToday(await getVoiceUsage(userId)).speakChars < text.length) {
    return NextResponse.json({ error: "You've used today's voice replies. The transcript keeps going." }, { status: 429 });
  }
  try {
    const audio = await speak(text, req.signal);
    await addVoiceUsage(userId, 0, text.length);
    return new Response(audio.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[voice] speech failed", err);
    return NextResponse.json({ error: "My voice cut out. The reply is in the transcript." }, { status: 502 });
  }
}
