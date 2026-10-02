import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { SiteHeader } from "@/components/workspace/SiteHeader";
import { Workspace } from "@/components/workspace/Workspace";
import { getSessionUserId } from "@/lib/auth/session";
import { getPathway } from "@/lib/db/queries";
import { loadPanels } from "@/lib/workspace/service";
import { initialTopics } from "@/lib/workspace/topics";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = { title: "Pathways" };

export default async function PathwayPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const userId = await getSessionUserId();
  if (!userId) redirect(`/?next=${encodeURIComponent(`/pathways/${id}`)}`);

  const pathway = await getPathway(userId, id);
  if (!pathway) notFound();

  const [{ nextSteps, recentWins }, query] = await Promise.all([loadPanels(userId, pathway.id), searchParams]);
  const place = typeof query.place === "string" && query.place.trim() ? query.place.slice(0, 300) : null;
  const label = typeof query.label === "string" ? query.label.slice(0, 120) : null;

  return (
    <>
      <SiteHeader />
      <Workspace
        pathway={pathway}
        initialSteps={nextSteps}
        initialWins={recentWins}
        initialTopics={initialTopics(pathway)}
        sharedPlace={place ? { query: place, label } : null}
      />
    </>
  );
}
