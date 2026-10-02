import { NextResponse } from "next/server";
import { isSafeTargetPath, redeemHandoffToken } from "@/lib/auth/handoff";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /handoff?t=... — redeems a single-use handoff link and continues the session on this device. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t");
  const handoff = token ? await redeemHandoffToken(token) : null;
  if (!handoff || !isSafeTargetPath(handoff.targetPath)) {
    return NextResponse.redirect(new URL("/?handoff=expired", req.url));
  }

  const res = NextResponse.redirect(new URL(handoff.targetPath, req.url));
  res.cookies.set(SESSION_COOKIE, createSessionToken(handoff.userId), sessionCookieOptions);
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
