"use client";

/**
 * System-suggested topics: quiet pills marked with a leaf dot and a "suggested" label,
 * so they never read as something the person wrote.
 */
export function SuggestedTopics({ topics, disabled, onPick }: { topics: string[]; disabled: boolean; onPick: (topic: string) => void }) {
  if (topics.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Suggested topics"
      className="-mx-gutter flex items-center gap-1.5 overflow-x-auto px-gutter [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      <span className="mr-0.5 shrink-0 font-mono text-[11px] text-muted-foreground">suggested</span>
      {topics.map((topic) => (
        <button
          key={topic}
          type="button"
          disabled={disabled}
          onClick={() => onPick(topic)}
          className="btn btn-secondary btn-sm h-8 shrink-0 gap-2 text-sm font-normal hover:border-forest/50"
        >
          <span className="size-1.5 rounded-full bg-leaf" aria-hidden />
          {topic}
        </button>
      ))}
    </div>
  );
}
