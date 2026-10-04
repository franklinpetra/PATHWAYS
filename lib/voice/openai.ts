import "server-only";
import { VOICE_STYLE } from "./persona";

/**
 * OpenAI speech models, called only from our server with OPENAI_API_KEY. Audio passes through
 * to OpenAI and back; nothing here writes it anywhere.
 */

const BASE = "https://api.openai.com/v1";
export const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
export const SPEECH_MODEL = "gpt-4o-mini-tts";
export const SPEECH_VOICE = "coral";

function key(): string {
  const value = process.env.OPENAI_API_KEY;
  if (!value) throw new Error("OPENAI_API_KEY is not set");
  return value;
}

export async function transcribe(audio: Blob, filename: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("model", TRANSCRIBE_MODEL);
  form.append("file", audio, filename);
  form.append("response_format", "json");
  // No prompt: on near-silent audio the model can return its prompt as if it were speech.
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}` },
    body: form,
    signal,
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/** Streams MP3 speech for `text`. */
export async function speak(text: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: SPEECH_MODEL, voice: SPEECH_VOICE, input: text, instructions: VOICE_STYLE, response_format: "mp3" }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Speech failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** For the health check: the key is set and can see the speech model. */
export async function voiceAvailable(): Promise<{ ok: boolean; detail: string }> {
  if (!process.env.OPENAI_API_KEY) return { ok: false, detail: "OPENAI_API_KEY is not set" };
  const res = await fetch(`${BASE}/models/${SPEECH_MODEL}`, { headers: { Authorization: `Bearer ${key()}` }, cache: "no-store" });
  return res.ok ? { ok: true, detail: `${TRANSCRIBE_MODEL} + ${SPEECH_MODEL} (${SPEECH_VOICE})` } : { ok: false, detail: `OpenAI returned ${res.status}` };
}
