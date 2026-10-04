"use client";

import { Pencil } from "lucide-react";
import { useState, type FormEvent } from "react";
import { formatDay } from "@/lib/client/format";
import type { EvidenceStatus, ProgressEvent } from "@/lib/db/types";
import type { UserAction, WinCandidate } from "@/lib/validation/state-guard";
import { Card } from "./Card";

const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  user_reported: "Self-reported",
  advisor_confirmed: "Advisor confirmed",
  system_verified: "Verified",
};

interface RecentWinsProps {
  wins: ProgressEvent[];
  /** Wins the conversation surfaced; recorded only if the person adds them. */
  candidates: WinCandidate[];
  busy: boolean;
  onAction: (actions: UserAction[]) => void;
  onDismissCandidate: (candidate: WinCandidate) => void;
  /** "inline" sits inside Your Route as "Wins along the way", without its own card. */
  variant?: "card" | "inline";
}

export function RecentWins({ wins, candidates, busy, onAction, onDismissCandidate, variant = "card" }: RecentWinsProps) {
  const body = (
    <>
      {candidates.length > 0 && (
        <div className="mb-3 rounded-2xl border border-dashed border-dawn/40 bg-dawn-tint p-3">
          <p className="text-xs font-medium text-dawn">Sounds like progress. Add it?</p>
          <ul className="mt-2 space-y-2">
            {candidates.map((c) => (
              <li key={`${c.event_type}:${c.title}`} className="text-sm">
                <p>{c.title}</p>
                <div className="mt-1 flex gap-1 text-xs">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onAction([
                        {
                          type: "record_win",
                          win: { pathwayId: c.pathway_id, eventType: c.event_type, title: c.title, learning: c.learning, stage: c.stage },
                        },
                      ]);
                      onDismissCandidate(c);
                    }}
                    className="btn btn-primary btn-sm"
                  >
                    Add to wins
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismissCandidate(c)}
                    className="btn btn-ghost btn-sm"
                  >
                    Not this one
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {wins.length === 0 ? (
        <p className="text-sm text-muted-foreground">Steps you take show up here.</p>
      ) : (
        <ul className="space-y-2.5">
          {wins.map((win) => (
            <WinItem key={win.id} win={win} busy={busy} onAction={onAction} />
          ))}
        </ul>
      )}
    </>
  );
  if (variant === "card") {
    return (
      <Card title="Recent wins" id="recent-wins-heading">
        {body}
      </Card>
    );
  }
  return (
    <section aria-labelledby="recent-wins-heading">
      <h2 id="recent-wins-heading" className="eyebrow mb-2">
        Wins along the way
      </h2>
      {body}
    </section>
  );
}

function WinItem({ win, busy, onAction }: { win: ProgressEvent; busy: boolean; onAction: (a: UserAction[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(win.title);
  const [learning, setLearning] = useState(win.learning ?? "");

  function cancel() {
    setTitle(win.title);
    setLearning(win.learning ?? "");
    setEditing(false);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    if (trimmed !== win.title || learning.trim() !== (win.learning ?? "")) {
      onAction([{ type: "edit_win", progressEventId: win.id, title: trimmed, learning: learning.trim() || null }]);
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <li>
        <form onSubmit={save} onKeyDown={(e) => e.key === "Escape" && cancel()} className="space-y-2">
          <label className="block">
            <span className="sr-only">Win, in your words</span>
            <input
              autoFocus
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              className="field field-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">What you took from it (optional)</span>
            <textarea
              value={learning}
              maxLength={600}
              rows={2}
              onChange={(e) => setLearning(e.target.value)}
              className="field field-sm field-multiline mt-1 resize-none"
            />
          </label>
          <div className="flex gap-1 text-xs">
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="btn btn-primary btn-sm"
            >
              Save
            </button>
            <button type="button" onClick={cancel} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-2.5">
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-dawn" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{win.title}</p>
        {win.learning && <p className="mt-0.5 text-xs text-muted-foreground">{win.learning}</p>}
        <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <time dateTime={win.occurred_at}>{formatDay(win.occurred_at)}</time>
          <span
            className={`badge ${win.evidence_status === "user_reported" ? "" : "border-forest/30 bg-leaf-tint text-forest"}`}
          >
            {EVIDENCE_LABEL[win.evidence_status]}
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Rephrase: ${win.title}`}
        className="btn btn-ghost btn-icon size-7 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Pencil className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}
