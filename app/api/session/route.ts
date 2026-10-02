import { NextResponse } from "next/server";
import { z } from "zod";
import { hashAccessCode } from "@/lib/auth/access-code";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth/session";
import { findUserByAccessCodeHash } from "@/lib/db/queries";

export const runtime = "nodejs";

const bodySchema = z.object({ accessCode: z.string().min(1).max(128) });

/** Sign in with an access code. Signing in never records a progress event. */
export async function POST(req: Request) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Enter your access code." }, { status: 400 });

  const user = await findUserByAccessCodeHash(hashAccessCode(body.data.accessCode));
  if (!user) return NextResponse.json({ error: "That access code didn't match." }, { status: 401 });

  const res = NextResponse.json({ username: user.username });
  res.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions);
  return res;
}

export async function DELETE() {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return res;
}
