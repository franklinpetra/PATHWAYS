"use client";

import { ExternalLink } from "lucide-react";
import { attributionWhen, formatAttribution } from "@/lib/workspace/attribution";
import type { Citation } from "@/lib/workspace/events";

export function citationAnchor(messageId: string, index: number): string {
  return `cite-${messageId}-${index}`;
}

/**
 * Expandable attribution for every sourced claim a reply cited:
 * [Source Name | Observation Period / As-of Date | Verification Authority].
 */
export function SourceList({
  messageId,
  citations,
  open,
  onToggle,
}: {
  messageId: string;
  citations: Citation[];
  open: ReadonlySet<number>;
  onToggle: (index: number, open: boolean) => void;
}) {
  if (citations.length === 0) return null;
  return (
    <section aria-label="Sources" className="mt-4 border-t border-border pt-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Sources</h3>
      <ol className="mt-2 space-y-1.5">
        {citations.map((c) => (
          <li key={c.index}>
            <details
              id={citationAnchor(messageId, c.index)}
              open={open.has(c.index)}
              onToggle={(e) => {
                const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                if (isOpen !== open.has(c.index)) onToggle(c.index, isOpen);
              }}
              className="group scroll-mt-24 rounded-2xl border border-transparent text-sm open:border-border open:bg-surface"
            >
              <summary className="flex cursor-pointer list-none items-baseline gap-2 rounded-full px-3 py-1 hover:bg-subtle [&::-webkit-details-marker]:hidden">
                <span className="text-xs font-medium text-forest">[{c.index}]</span>
                <span className="line-clamp-2 min-w-0 flex-1 text-muted-foreground">
                  <span className="font-medium text-foreground">{c.source.name}</span>
                  <span aria-hidden> · </span>
                  {attributionWhen(c.source)}
                </span>
                <span className="text-xs text-muted-foreground group-open:hidden">Details</span>
                <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
              </summary>
              <div className="space-y-2 px-3 pt-1 pb-3">
                <p>{c.statement}</p>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-muted-foreground">Source</dt>
                  <dd>{c.source.name}</dd>
                  <dt className="text-muted-foreground">{c.source.observationPeriod ? "Period / as of" : "As of"}</dt>
                  <dd>{attributionWhen(c.source).replace(/^As of /, "")}</dd>
                  <dt className="text-muted-foreground">Verified by</dt>
                  <dd>{c.source.verificationAuthority}</dd>
                </dl>
                <p className="sr-only">{formatAttribution(c.source)}</p>
                <a
                  href={c.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                >
                  View source
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
