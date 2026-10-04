import Link from "next/link";
import { SignInForm } from "@/components/auth/SignInForm";
import { Logo } from "@/components/brand/Logo";
import { SiteHeader } from "@/components/workspace/SiteHeader";
import { getSessionUserId } from "@/lib/auth/session";
import { listPathways } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: PageProps) {
  const userId = await getSessionUserId();
  const query = await searchParams;

  if (!userId) {
    const next = typeof query.next === "string" ? query.next : null;
    return (
      <div className="flex min-h-dvh flex-col">
        <header className="mx-auto w-full max-w-6xl px-gutter pt-6 sm:pt-10">
          <Logo size="lg" />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-gutter pt-14 pb-section sm:pt-24">
          <div className="max-w-2xl">
            <h1 className="display">
              Where do you want to go <span className="text-forest">next?</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Think out loud. We&apos;ll check the facts, do the math, and map your next steps.
            </p>
            {query.handoff === "expired" && (
              <p role="status" className="notice mt-8 max-w-xl">
                That link has expired or was already used. Sign in with your access code instead.
              </p>
            )}
            <SignInForm next={next} />
          </div>
        </main>
        <footer className="mx-auto w-full max-w-6xl px-gutter pb-10">
          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
            Every fee, wage, and rule comes from an official Washington source, shown with its date. What Pathways
            remembers about you is yours to review, edit, or delete.
          </p>
        </footer>
      </div>
    );
  }

  const pathways = (await listPathways(userId)).filter((p) => !["abandoned", "superseded"].includes(p.status));
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-gutter py-section">
        <h1 className="display-sm">Your pathways</h1>
        {pathways.length === 0 ? (
          <p className="mt-4 text-muted-foreground">No pathways yet.</p>
        ) : (
          <ul className="mt-8 divide-y divide-border rounded-card border border-border bg-surface">
            {pathways.map((p) => (
              <li key={p.id}>
                <Link href={`/pathways/${p.id}`} className="block px-6 py-5 transition-colors hover:bg-subtle">
                  <span className="text-lg font-medium tracking-tight">{p.title}</span>
                  {p.current_question && <span className="mt-0.5 block text-sm text-muted-foreground">{p.current_question}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
