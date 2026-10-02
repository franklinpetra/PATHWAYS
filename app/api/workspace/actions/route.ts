import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { getPathway } from "@/lib/db/queries";
import { userActionSchema } from "@/lib/validation/state-guard";
import type { PanelsResponse } from "@/lib/workspace/events";
import { applyUserActions, loadPanels } from "@/lib/workspace/service";

export const runtime = "nodejs";

const bodySchema = z.object({
  pathwayId: z.uuid(),
  actions: z.array(userActionSchema).min(1).max(20),
});

/**
 * POST /api/workspace/actions
 *
 * Applies the person's own controls on Next Steps and Recent Wins (complete, reorder,
 * not now, remove, due date, edit a win, record a win) through the state guard, and
 * returns the refreshed cards.
 */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const pathway = await getPathway(userId, body.data.pathwayId);
  if (!pathway) return NextResponse.json({ error: "Pathway not found." }, { status: 404 });

  const rejections = await applyUserActions(userId, body.data.actions);
  const panels = await loadPanels(userId, pathway.id);
  return NextResponse.json({ ...panels, rejected: rejections.length } satisfies PanelsResponse);
}
