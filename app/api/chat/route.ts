import { NextResponse } from "next/server";
import { z } from "zod";
import { runTurn } from "@/lib/agents/orchestrator";
import { getSessionUserId } from "@/lib/auth/session";
import { userActionSchema } from "@/lib/validation/state-guard";
import type { ChatEvent } from "@/lib/workspace/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    message: z.string().trim().max(4000).nullish(),
    pathwayId: z.uuid().nullish(),
    userActions: z.array(userActionSchema).max(10).default([]),
  })
  .refine((b) => Boolean(b.message) || b.userActions.length > 0, { message: "Send a message or an action." });

/**
 * POST /api/chat
 *
 * The conversation history is read from the stored transcript; both the person's
 * message and the reply (complete or interrupted) are persisted.
 *
 * Streams newline-delimited JSON (application/x-ndjson), one ChatEvent per line:
 *   {"type":"text","delta":"..."}                         reply text, in order
 *   {"type":"places","items":[...]}                       sourced addresses cited in the reply
 *   {"type":"topics","items":[...]}                       suggested follow-up topics
 *   {"type":"next_steps","items":[...]}                   open Next Steps for the pathway
 *   {"type":"wins","recent":[...],"candidates":[...]}     Recent Wins, plus wins the person may choose to record
 *   {"type":"error","message":"..."}
 *   {"type":"done"}
 */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatEvent) => {
        if (req.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runTurn(
          {
            userId,
            message: body.message || null,
            pathwayId: body.pathwayId ?? null,
            userActions: body.userActions,
            signal: req.signal,
          },
          emit,
        );
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[api/chat] turn failed", err);
          emit({ type: "error", message: "Something went wrong on our side. Please try again." });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
