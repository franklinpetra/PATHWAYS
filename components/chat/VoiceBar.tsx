"use client";

import type { VoiceState } from "./useVoiceConversation";

const LABEL: Record<Exclude<VoiceState, "off">, string> = {
  starting: "Saying hello…",
  listening: "Listening…",
  transcribing: "Got it…",
  thinking: "Thinking it through…",
  speaking: "Speaking…",
};

/** Status of a voice conversation, with the person's controls. */
export function VoiceBar({
  state,
  notice,
  onFinishTurn,
  onEnd,
}: {
  state: VoiceState;
  notice: string | null;
  onFinishTurn: () => void;
  onEnd: () => void;
}) {
  if (state === "off") {
    return notice ? (
      <p role="status" className="text-xs text-muted-foreground">
        {notice}
      </p>
    ) : null;
  }
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 rounded-full border border-dawn/30 bg-dawn-tint px-3 py-1.5 text-sm">
      <span className="relative flex size-2.5" aria-hidden>
        <span className={`absolute inline-flex size-full rounded-full bg-dawn opacity-60 ${state === "listening" ? "animate-ping" : ""}`} />
        <span className="relative inline-flex size-2.5 rounded-full bg-dawn" />
      </span>
      <span className="font-medium text-dawn">{LABEL[state]}</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">Your voice becomes text via OpenAI; audio isn&apos;t saved.</span>
      <span className="ml-auto flex gap-1">
        {state === "listening" && (
          <button type="button" onClick={onFinishTurn} className="btn btn-sm btn-secondary">
            Done talking
          </button>
        )}
        <button type="button" onClick={onEnd} className="btn btn-sm btn-ghost">
          End voice
        </button>
      </span>
    </div>
  );
}
