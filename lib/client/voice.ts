/**
 * Browser side of voice: record one turn, notice when the person stops talking, and play
 * PATHWAYS' spoken lines. Audio leaves the browser only to our /api/voice routes and is never
 * stored there.
 */

export const MAX_TURN_MS = 90_000;
/** Silence after speech that ends a turn. */
const END_SILENCE_MS = 1_500;
/** With no speech at all for this long, the turn ends empty. */
const NO_SPEECH_MS = 8_000;

export interface Recording {
  blob: Blob;
  seconds: number;
  /** Whether any speech was detected. */
  heard: boolean;
}

export interface TurnRecorder {
  /** Resolves when the turn ends: silence after speech, no speech, the time limit, or finish(). */
  done: Promise<Recording>;
  /** End the turn now and keep what was said. */
  finish: () => void;
  /** End the turn and discard it. */
  cancel: () => void;
}

export function voiceSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

function pickMimeType(): string | undefined {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

export async function recordTurn(): Promise<TurnRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

  // Voice activity: compare loudness with the room's noise floor, measured in the first moments.
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const started = performance.now();
  let floor = 0;
  let floorSamples = 0;
  let heard = false;
  let lastVoice = started;
  let cancelled = false;

  const done = new Promise<Recording>((resolve) => {
    recorder.onstop = () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
      const seconds = (performance.now() - started) / 1000;
      resolve({ blob: new Blob(cancelled ? [] : chunks, { type: recorder.mimeType || mimeType || "audio/webm" }), seconds, heard: heard && !cancelled });
    };
  });

  const stop = () => recorder.state !== "inactive" && recorder.stop();
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    const level = Math.sqrt(sum / samples.length);
    const now = performance.now();
    if (now - started < 400) {
      floor = (floor * floorSamples + level) / ++floorSamples;
      return;
    }
    if (level > Math.max(0.02, floor * 3)) {
      heard = true;
      lastVoice = now;
    }
    if ((heard && now - lastVoice > END_SILENCE_MS) || (!heard && now - started > NO_SPEECH_MS) || now - started > MAX_TURN_MS) stop();
  }, 100);

  recorder.start(250);
  return {
    done,
    finish: stop,
    cancel: () => {
      cancelled = true;
      stop();
    },
  };
}

/** One audio element, unlocked during the tap that starts voice, so later replies can play on phones. */
export class Speaker {
  private audio = new Audio();
  private url: string | null = null;

  unlock() {
    // A short silent clip played inside the user's tap lets later playback start without one.
    this.audio.src = URL.createObjectURL(silentWav());
    void this.audio.play().catch(() => {});
  }

  /** Plays one clip; resolves when it ends or is stopped. */
  play(blob: Blob): Promise<void> {
    this.stop();
    this.url = URL.createObjectURL(blob);
    this.audio.src = this.url;
    return new Promise((resolve) => {
      const end = () => resolve();
      this.audio.onended = end;
      this.audio.onpause = end;
      this.audio.onerror = end;
      this.audio.play().catch(end);
    });
  }

  stop() {
    this.audio.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}

export async function transcribeTurn(recording: Recording, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  const extension = recording.blob.type.includes("mp4") ? "m4a" : recording.blob.type.includes("ogg") ? "ogg" : "webm";
  form.append("audio", recording.blob, `turn.${extension}`);
  form.append("seconds", String(Math.ceil(recording.seconds)));
  const res = await fetch("/api/voice/transcribe", { method: "POST", body: form, signal });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "I couldn't make that out.");
  return String(data?.text ?? "").trim();
}

export async function fetchSpeech(pathwayId: string, text: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch("/api/voice/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pathwayId, text }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "My voice cut out.");
  }
  return res.blob();
}

/** 50 ms of silence as a valid 8 kHz mono 16-bit WAV. */
function silentWav(): Blob {
  const samples = 400;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  return new Blob([buffer], { type: "audio/wav" });
}
