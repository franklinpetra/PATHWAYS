import { NextResponse } from "next/server";
import { z } from "zod";
import { createHandoffToken } from "@/lib/auth/handoff";
import { getSessionUserId } from "@/lib/auth/session";
import { getPathway } from "@/lib/db/queries";

export const runtime = "nodejs";

const bodySchema = z.object({
  pathwayId: z.uuid(),
  place: z.object({ query: z.string().min(1).max(300), label: z.string().max(120).nullish() }).nullish(),
});

/** POST /api/handoff — a single-use link that opens this pathway, signed in, on another device. */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const pathway = await getPathway(userId, body.data.pathwayId);
  if (!pathway) return NextResponse.json({ error: "Pathway not found." }, { status: 404 });

  const params = new URLSearchParams();
  if (body.data.place) {
    params.set("place", body.data.place.query);
    if (body.data.place.label) params.set("label", body.data.place.label);
  }
  const target = `/pathways/${pathway.id}${params.size ? `?${params}` : ""}`;
  const { token, expiresAt } = await createHandoffToken(userId, target);

  const url = new URL("/handoff", req.url);
  url.searchParams.set("t", token);
  return NextResponse.json({ url: url.toString(), expiresAt });
}
