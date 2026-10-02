import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { SiteHeader } from "@/components/workspace/SiteHeader";
import { Workspace } from "@/components/workspace/Workspace";
import { getSessionUserId } from "@/lib/auth/session";
import { getPathway, listMessages } from "@/lib/db/queries";
import type { Citation, VerifiedPlace } from "@/lib/workspace/events";
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

  const [{ nextSteps, recentWins }, stored, query] = await Promise.all([
    loadPanels(userId, pathway.id),
    listMessages(userId, pathway.id, 100),
    searchParams,
  ]);
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
        initialMessages={stored.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          status: "done",
          interrupted: m.status === "interrupted",
          places: m.places as VerifiedPlace[],
          citations: m.citations as Citation[],
          unverifiedFigures: m.unverified_figures ?? [],
        }))}
      />
    </>
  );
}
