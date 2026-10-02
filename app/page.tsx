import Link from "next/link";
import { SignInForm } from "@/components/auth/SignInForm";
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
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-gutter py-section">
        <p className="text-sm font-medium tracking-wide text-primary">Pathways</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Welcome back.</h1>
        <p className="mt-3 text-muted-foreground">Think out loud. We&apos;ll organize what you share — you decide what matters.</p>
        {query.handoff === "expired" && (
          <p role="status" className="mt-6 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
            That link has expired or was already used. Sign in with your access code instead.
          </p>
        )}
        <SignInForm next={next} />
      </main>
    );
  }

  const pathways = (await listPathways(userId)).filter((p) => !["abandoned", "superseded"].includes(p.status));
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-xl px-gutter py-section">
        <h1 className="text-2xl font-semibold tracking-tight">Your pathways</h1>
        {pathways.length === 0 ? (
          <p className="mt-4 text-muted-foreground">No pathways yet.</p>
        ) : (
          <ul className="mt-6 divide-y divide-border rounded-card border border-border bg-surface">
            {pathways.map((p) => (
              <li key={p.id}>
                <Link href={`/pathways/${p.id}`} className="block px-5 py-4 transition-colors hover:bg-background">
                  <span className="font-medium">{p.title}</span>
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
