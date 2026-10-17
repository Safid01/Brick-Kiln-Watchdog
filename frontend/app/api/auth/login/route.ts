import { NextResponse } from "next/server";
import {
  authEnabled,
  createSessionToken,
  loginThrottled,
  passwordMatches,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (req.headers.get("x-bk-csrf") !== "1") {
    return NextResponse.json({ error: "Missing CSRF header" }, { status: 403 });
  }
  if (!authEnabled()) {
    return NextResponse.json(
      { error: "Inspector login is not configured on this server." },
      { status: 403 },
    );
  }
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  if (loginThrottled(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
  }

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (typeof password !== "string" || !passwordMatches(password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "strict",
    // Secure cookies are dropped by browsers on plain http://<ip>. Set COOKIE_SECURE=false
    // only for an HTTP-only test deployment; leave unset when serving over HTTPS.
    secure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}
