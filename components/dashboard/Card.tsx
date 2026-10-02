import type { ReactNode } from "react";

export function Card({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-card border border-border bg-surface p-5 shadow-xs">
      <h2 id={id} className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
