import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { listAllContextItems } from "@/lib/db/queries";
import { memoryActionSchema } from "@/lib/validation/state-guard";
import { applyUserActions } from "@/lib/workspace/service";

export const runtime = "nodejs";

const bodySchema = z.object({ actions: z.array(memoryActionSchema).min(1).max(20) });

/**
 * POST /api/account/memory
 *
 * Keep, edit, or delete what Pathways remembers. Deleting archives the item, which
 * removes it from every future prompt. Returns the full, refreshed record.
 */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const rejections = await applyUserActions(userId, body.data.actions);
  return NextResponse.json({ items: await listAllContextItems(userId), rejected: rejections.length });
}
