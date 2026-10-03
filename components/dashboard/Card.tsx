import type { ReactNode } from "react";

export function Card({ title, id, children, aside }: { title: string; id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-card border border-border bg-surface px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="eyebrow">
          {title}
        </h2>
        {aside}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
