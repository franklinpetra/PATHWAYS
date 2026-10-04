"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Speaker, fetchSpeech, recordTurn, transcribeTurn, voiceSupported, type TurnRecorder } from "@/lib/client/voice";
import { GREETINGS } from "@/lib/voice/persona";

export type VoiceState = "off" | "starting" | "listening" | "transcribing" | "thinking" | "speaking";

/**
 * A spoken conversation loop: hello, then listen, transcribe, let PATHWAYS answer (the full
 * reply lands in the transcript), speak the short line, and listen again until the person ends it.
 * `send` posts the transcript as the person's message and resolves when the reply is complete.
 */
export function useVoiceConversation({ pathwayId, send }: { pathwayId: string; send: (text: string) => Promise<void> }) {
  const [state, setState] = useState<VoiceState>("off");
  const [notice, setNotice] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const session = useRef(0);
  const speaker = useRef<Speaker | null>(null);
  const recorder = useRef<TurnRecorder | null>(null);
  const speaking = useRef<Promise<void> | null>(null);
  /** The live session's id, or 0 when voice is off (a ref, so late events see the current value). */
  const active = useRef(0);
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => setSupported(voiceSupported()), []);
  useEffect(
    () => () => {
      session.current++;
      recorder.current?.cancel();
      speaker.current?.stop();
    },
    [],
  );

  const end = useCallback((message: string | null = null) => {
    session.current++;
    active.current = 0;
    recorder.current?.cancel();
    recorder.current = null;
    speaker.current?.stop();
    speaking.current = null;
    setState("off");
    setNotice(message);
  }, []);

  const speak = useCallback(
    async (id: number, text: string) => {
      if (session.current !== id || !speaker.current) return;
      setState("speaking");
      try {
        const audio = await fetchSpeech(pathwayId, text);
        if (session.current === id) await speaker.current.play(audio);
      } catch (err) {
        if (session.current === id) setNotice((err as Error).message);
      }
    },
    [pathwayId],
  );

  const listen = useCallback(
    async (id: number): Promise<void> => {
      while (session.current === id) {
        setState("listening");
        let turn: TurnRecorder;
        try {
          turn = await recordTurn();
        } catch {
          return end("I need microphone access to listen. You can allow it in your browser's site settings.");
        }
        recorder.current = turn;
        const recording = await turn.done;
        recorder.current = null;
        if (session.current !== id) return;
        if (!recording.heard) return end("Still there? Tap the mic whenever you're ready.");

        setState("transcribing");
        let text: string;
        try {
          text = await transcribeTurn(recording);
        } catch (err) {
          return end((err as Error).message);
        }
        if (session.current !== id) return;
        if (!text) continue;

        setState("thinking");
        speaking.current = null;
        await sendRef.current(text);
        // The spoken line may still be playing; listen again once it's done.
        if (speaking.current) await speaking.current;
      }
    },
    [end],
  );

  /** Called with the reply's spoken line as it arrives. */
  const say = useCallback(
    (text: string) => {
      const id = active.current;
      if (!id || id !== session.current) return;
      speaking.current = speak(id, text);
    },
    [speak],
  );

  const start = useCallback(async () => {
    if (!supported) return setNotice("Voice isn't available in this browser. Chrome, Edge, and Safari support it.");
    const id = ++session.current;
    active.current = id;
    setNotice(null);
    speaker.current ??= new Speaker();
    speaker.current.unlock();
    setState("starting");
    await speak(id, GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
    await listen(id);
  }, [listen, speak, supported]);

  return {
    state,
    notice,
    supported,
    start,
    end: () => end(null),
    /** Ends the current spoken turn early and sends what was said. */
    finishTurn: () => recorder.current?.finish(),
    say,
  };
}
