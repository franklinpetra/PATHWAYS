"use client";

/**
 * System-suggested topics: quiet pills marked with a leaf dot and a "suggested" label,
 * so they never read as something the person wrote.
 */
export function SuggestedTopics({ topics, disabled, onPick }: { topics: string[]; disabled: boolean; onPick: (topic: string) => void }) {
  if (topics.length === 0) return null;
  return (
    <div role="group" aria-label="Suggested topics" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-mono text-xs text-muted-foreground">suggested</span>
      {topics.map((topic) => (
        <button
          key={topic}
          type="button"
          disabled={disabled}
          onClick={() => onPick(topic)}
          className="btn btn-secondary btn-sm h-8 gap-2 text-sm font-normal hover:border-forest/50"
        >
          <span className="size-1.5 rounded-full bg-leaf" aria-hidden />
          {topic}
        </button>
      ))}
    </div>
  );
}
