import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { addVoiceUsage, getVoiceUsage } from "@/lib/db/queries";
import { transcribe } from "@/lib/voice/openai";
import { MAX_AUDIO_BYTES, MAX_RECORDING_SECONDS, remainingToday } from "@/lib/voice/persona";

export const runtime = "nodejs";

/**
 * POST /api/voice/transcribe  (multipart: audio, seconds)
 *
 * Turns one recording into text. The audio goes to OpenAI and nowhere else; it is never
 * stored. Only the returned text becomes part of the conversation, sent as a normal message.
 */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "No recording received." }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "That recording is too long. Try a shorter one." }, { status: 413 });

  // The browser reports the length; it is capped, and file size bounds it independently.
  const seconds = Math.min(MAX_RECORDING_SECONDS, Math.max(1, Math.ceil(Number(form?.get("seconds")) || MAX_RECORDING_SECONDS)));
  const left = remainingToday(await getVoiceUsage(userId));
  if (left.transcribeSeconds < seconds) {
    return NextResponse.json({ error: "You've used today's voice time. Typing still works, and voice resets tomorrow." }, { status: 429 });
  }

  const type = audio.type || "audio/webm";
  const extension = type.includes("mp4") || type.includes("m4a") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
  try {
    const text = await transcribe(audio, `speech.${extension}`, req.signal);
    await addVoiceUsage(userId, seconds, 0);
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[voice] transcription failed", err);
    return NextResponse.json({ error: "I couldn't make that out. Try again, or type it." }, { status: 502 });
  }
}
