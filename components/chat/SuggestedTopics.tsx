"use client";

import { Sparkles } from "lucide-react";

/**
 * System-suggested topics. Styled as dashed, sage-tinted chips so they never read
 * as something the person wrote.
 */
export function SuggestedTopics({ topics, disabled, onPick }: { topics: string[]; disabled: boolean; onPick: (topic: string) => void }) {
  if (topics.length === 0) return null;
  return (
    <div role="group" aria-label="Suggested topics" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-primary/80">
        <Sparkles className="size-3" aria-hidden />
        Suggested
      </span>
      {topics.map((topic) => (
        <button
          key={topic}
          type="button"
          disabled={disabled}
          onClick={() => onPick(topic)}
          className="rounded-full border border-dashed border-primary/45 bg-primary/5 px-3 py-1 text-sm text-primary transition-colors hover:border-primary hover:bg-primary/10 disabled:opacity-50"
        >
          {topic}
        </button>
      ))}
    </div>
  );
}
