"use client";

import { ArrowUp, Square } from "lucide-react";
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

interface ComposerProps {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ streaming, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const message = text.trim();
    if (!message || streaming) return;
    onSend(message);
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 rounded-[2rem] border border-border bg-surface p-2.5 pl-4 transition-[border-color,box-shadow] focus-within:border-forest focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-leaf)_28%,transparent)]"
    >
      <label htmlFor="composer" className="sr-only">
        Message
      </label>
      <textarea
        id="composer"
        ref={ref}
        rows={1}
        value={text}
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Think out loud…"
        className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-2 text-base leading-relaxed outline-none placeholder:text-muted-foreground/70 focus-visible:shadow-none focus-visible:outline-none"
      />
      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          className="btn btn-secondary btn-icon size-10"
        >
          <Square className="size-3.5 fill-current" aria-hidden />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Send"
          className="btn btn-primary btn-icon size-10"
        >
          <ArrowUp className="size-4" aria-hidden />
        </button>
      )}
    </form>
  );
}
