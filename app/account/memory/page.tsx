import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MemoryList } from "@/components/memory/MemoryList";
import { SiteHeader } from "@/components/workspace/SiteHeader";
import { getSessionUserId } from "@/lib/auth/session";
import { listAllContextItems } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My story · Pathways" };

export default async function MemoryPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect(`/?next=${encodeURIComponent("/account/memory")}`);

  const items = await listAllContextItems(userId);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-gutter py-10">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-primary">My story</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">What Pathways remembers</h1>
        <p className="mt-3 text-muted-foreground">
          This is everything Pathways has taken from your conversations, and it shapes every reply. Keep what&apos;s
          right, edit anything into your own words, and delete what you don&apos;t want used.
        </p>
        <MemoryList initialItems={items} />
      </main>
    </>
  );
}
