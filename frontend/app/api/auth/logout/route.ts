import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (req.headers.get("x-bk-csrf") !== "1") {
    return NextResponse.json({ error: "Missing CSRF header" }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
