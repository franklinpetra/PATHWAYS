"use client";

import { Check, Pencil, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { formatDay } from "@/lib/client/format";
import type { ContextItem, Provenance, SemanticStatus } from "@/lib/db/types";
import type { UserAction } from "@/lib/validation/state-guard";

const GROUPS: { title: string; description: string; match: (i: ContextItem) => boolean }[] = [
  {
    title: "Goals",
    description: "Where you want to go.",
    match: (i) => i.type === "goal" || i.semantic_status === "confirmed_goal",
  },
  { title: "Constraints", description: "What any path has to work around.", match: (i) => i.type === "constraint" },
  {
    title: "Priorities & interests",
    description: "What matters to you, and what draws you.",
    match: (i) => i.type === "preference" || i.type === "interest" || i.semantic_status === "saved_interest",
  },
  {
    title: "About you",
    description: "Your circumstances, experience, and strengths.",
    match: (i) => ["circumstance", "experience", "strength"].includes(i.type),
  },
  {
    title: "Open questions & concerns",
    description: "Things you're still weighing.",
    match: (i) => i.type === "concern" || i.type === "question",
  },
];

const PROVENANCE_LABEL: Record<Provenance, string> = {
  user_authored: "You said this",
  user_approved: "You confirmed this",
  ai_inferred: "Inferred, not confirmed",
  source_confirmed: "From a verified source",
};

const STATUS_LABEL: Record<SemanticStatus, string> = {
  thought: "A thought",
  inference: "An inference",
  possibility: "A possibility",
  confirmed_context: "About you",
  saved_interest: "Saved interest",
  confirmed_goal: "Your goal",
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function MemoryList({ initialItems }: { initialItems: ContextItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const live = items.filter((i) => i.temporal_status === "current" || i.temporal_status === "stale");
  const replaced = items.filter((i) => i.temporal_status === "superseded");
  const deleted = items.filter((i) => i.temporal_status === "archived");

  const grouped = GROUPS.map((g) => ({ ...g, items: [] as ContextItem[] }));
  for (const item of live) (grouped.find((g) => g.match(item)) ?? grouped[grouped.length - 1]).items.push(item);

  async function act(action: UserAction) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/account/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions: [action] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "That change couldn't be saved.");
      setItems(data.items);
      if (data.rejected > 0) setNotice("That change couldn't be saved. Refresh and try again.");
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      {notice && (
        <p role="status" className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      {live.length === 0 && (
        <p className="rounded-card border border-border bg-surface p-5 text-muted-foreground">
          Nothing yet. As you talk things through, what you share will appear here for you to review.
        </p>
      )}

      {grouped
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.title} aria-labelledby={`group-${g.title}`} className="rounded-card border border-border bg-surface p-5 shadow-xs">
            <h2 id={`group-${g.title}`} className="font-semibold">
              {g.title}
            </h2>
            <p className="text-sm text-muted-foreground">{g.description}</p>
            <ul className="mt-2 divide-y divide-border">
              {g.items.map((item) => (
                <MemoryItem key={item.id} item={item} busy={busy} onAction={act} />
              ))}
            </ul>
          </section>
        ))}

      {(replaced.length > 0 || deleted.length > 0) && (
        <section aria-label="History" className="space-y-2 text-sm">
          {replaced.length > 0 && (
            <HistoryList
              title={`Earlier versions (${replaced.length})`}
              note="Replaced by something newer you said or wrote. Not used in conversations."
              items={replaced}
            />
          )}
          {deleted.length > 0 && (
            <HistoryList
              title={`Deleted (${deleted.length})`}
              note="Never used in conversations again, and not re-learned unless you bring it up yourself. Your past messages stay in your conversation history."
              items={deleted}
            />
          )}
        </section>
      )}
    </div>
  );
}

function MemoryItem({ item, busy, onAction }: { item: ContextItem; busy: boolean; onAction: (a: UserAction) => void }) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [text, setText] = useState(item.display_text);
  const unconfirmed = item.provenance === "ai_inferred";
  const quote =
    item.user_language && normalize(item.user_language) !== normalize(item.display_text) ? item.user_language : null;

  function save(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (text.trim() !== item.display_text) onAction({ type: "edit_context_item", contextItemId: item.id, text });
    setMode("view");
  }

  if (mode === "edit") {
    return (
      <li className="py-4">
        <form onSubmit={save} onKeyDown={(e) => e.key === "Escape" && setMode("view")} className="space-y-2">
          <label htmlFor={`edit-${item.id}`} className="text-xs text-muted-foreground">
            In your own words
          </label>
          <textarea
            id={`edit-${item.id}`}
            autoFocus
            value={text}
            maxLength={280}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2"
          />
          <div className="flex gap-1 text-sm">
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setText(item.display_text);
                setMode("view");
              }}
              className="rounded-md px-3 py-1 text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="py-4">
      <p className={unconfirmed ? "text-foreground/85" : undefined}>{item.display_text}</p>
      {quote && <p className="mt-1 text-sm italic text-muted-foreground">&ldquo;{quote}&rdquo;</p>}
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span
          className={`rounded-full border px-1.5 py-px font-medium ${
            unconfirmed ? "border-dashed border-primary/50 text-primary" : "border-border"
          }`}
        >
          {PROVENANCE_LABEL[item.provenance]}
        </span>
        <span>{STATUS_LABEL[item.semantic_status]}</span>
        {item.temporal_status === "stale" && <span>· May be out of date</span>}
        <span>
          · <time dateTime={item.updated_at}>{formatDay(item.updated_at)}</time>
        </span>
      </p>

      {mode === "confirm-delete" ? (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-sm" role="group" aria-label="Confirm delete">
          <span className="mr-1 text-muted-foreground">Delete this? It won&apos;t be used again.</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction({ type: "archive_context_item", contextItemId: item.id })}
            className="rounded-md bg-foreground px-2.5 py-1 font-medium text-background disabled:opacity-50"
          >
            Delete
          </button>
          <button type="button" onClick={() => setMode("view")} className="rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1 text-sm">
          <ItemButton
            disabled={busy}
            emphasized={unconfirmed || item.temporal_status === "stale"}
            onClick={() => onAction({ type: "keep_context_item", contextItemId: item.id })}
            label={`Keep: ${item.display_text}`}
          >
            <Check className="size-3.5" aria-hidden />
            Keep
          </ItemButton>
          <ItemButton disabled={busy} onClick={() => setMode("edit")} label={`Edit: ${item.display_text}`}>
            <Pencil className="size-3.5" aria-hidden />
            Edit
          </ItemButton>
          <ItemButton disabled={busy} onClick={() => setMode("confirm-delete")} label={`Delete: ${item.display_text}`}>
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </ItemButton>
        </div>
      )}
    </li>
  );
}

function ItemButton({
  disabled,
  emphasized = false,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  emphasized?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 transition-colors disabled:opacity-50 ${
        emphasized
          ? "border-primary/40 text-primary hover:bg-primary/5"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function HistoryList({ title, note, items }: { title: string; note: string; items: ContextItem[] }) {
  return (
    <details className="rounded-card border border-border px-5 py-3">
      <summary className="cursor-pointer font-medium text-muted-foreground">{title}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((i) => (
          <li key={i.id} className="flex justify-between gap-4 text-muted-foreground">
            <span className="line-through decoration-border">{i.display_text}</span>
            <time dateTime={i.updated_at} className="shrink-0 text-xs">
              {formatDay(i.updated_at)}
            </time>
          </li>
        ))}
      </ul>
    </details>
  );
}
