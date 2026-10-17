import { NextResponse } from "next/server";
import { authEnabled, backendUrl, isAuthed } from "@/lib/server/auth";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const info: SessionInfo = {
    mode: backendUrl() ? "live" : "demo",
    authEnabled: authEnabled(),
    authed: await isAuthed(req),
  };
  return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
}
