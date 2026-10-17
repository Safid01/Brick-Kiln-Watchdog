import { NextResponse } from "next/server";
import { backendUrl, guardMutation } from "@/lib/server/auth";
import {
  demoAddKiln,
  demoAlerts,
  demoConfirm,
  demoReceptors,
  demoReject,
  demoStatus,
  demoUpdateTech,
} from "@/lib/server/demo";
import { SCAN_TARGETS } from "@/lib/types";

export const dynamic = "force-dynamic";

const KILN_ID = /^BK-[A-Za-z0-9_-]+$/;
const NO_STORE = { "Cache-Control": "no-store" };

type Route =
  | { kind: "alerts" | "system-status" | "scanner-status" | "receptors" | "districts" }
  | { kind: "trigger-scan" | "auto-sweep" | "add-kiln" | "purge-bogus" }
  | { kind: "confirm" | "reject"; id: string }
  | { kind: "update-tech"; id: string };

/** Strict allow-list: only the endpoints the dashboard needs are proxied. */
function match(method: "GET" | "POST", segs: string[]): Route | null {
  const p = segs.join("/");
  if (method === "GET") {
    if (p === "alerts") return { kind: "alerts" };
    if (p === "system-status") return { kind: "system-status" };
    if (p === "scanner-status") return { kind: "scanner-status" };
    if (p === "receptors") return { kind: "receptors" };
    if (p === "districts") return { kind: "districts" };
    return null;
  }
  if (p === "trigger-scan") return { kind: "trigger-scan" };
  if (p === "auto-sweep/toggle") return { kind: "auto-sweep" };
  if (p === "kilns/add") return { kind: "add-kiln" };
  if (p === "purge-bogus") return { kind: "purge-bogus" };
  const mTech = /^kilns\/([^/]+)\/technology$/.exec(p);
  if (mTech && KILN_ID.test(mTech[1])) return { kind: "update-tech", id: mTech[1] };
  const m = /^kilns\/([^/]+)\/(confirm|reject)$/.exec(p);
  if (m && KILN_ID.test(m[1])) return { kind: m[2] as "confirm" | "reject", id: m[1] };
  return null;
}

function backendPath(r: Route): string {
  switch (r.kind) {
    case "trigger-scan":
      return "/api/v1/trigger-scan";
    case "auto-sweep":
      return "/api/v1/auto-sweep/toggle";
    case "add-kiln":
      return "/api/v1/kilns/add";
    case "purge-bogus":
      return "/api/v1/purge-bogus";
    case "update-tech":
      return `/api/v1/kilns/${r.id}/technology`;
    case "confirm":
    case "reject":
      return `/api/v1/kilns/${r.id}/${r.kind}`;
    default:
      return `/api/v1/${r.kind}`;
  }
}


async function proxy(r: Route, method: "GET" | "POST", body?: unknown) {
  try {
    const res = await fetch(backendUrl() + backendPath(r), {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json", ...NO_STORE },
    });
  } catch {
    return NextResponse.json(
      { error: "Backend unreachable. Check BACKEND_URL and that web_server.py is running." },
      { status: 502, headers: NO_STORE },
    );
  }
}

async function demoGet(r: Route) {
  switch (r.kind) {
    case "alerts":
      return NextResponse.json(await demoAlerts(), { headers: NO_STORE });
    case "receptors":
      return NextResponse.json(await demoReceptors(), {
        headers: { "Cache-Control": "public, max-age=300" },
      });
    default: {
      const s = await demoStatus();
      return NextResponse.json(r.kind === "scanner-status" ? s.scanner_status : s, {
        headers: NO_STORE,
      });
    }
  }
}

async function demoPost(r: Route, body?: unknown) {
  if (r.kind === "confirm" || r.kind === "reject") {
    const ok = r.kind === "confirm" ? await demoConfirm(r.id) : await demoReject(r.id);
    if (!ok) return NextResponse.json({ status: "ERROR", message: "Kiln not found" }, { status: 404 });
    return NextResponse.json({
      status: "SUCCESS",
      message:
        r.kind === "confirm"
          ? `Kiln ${r.id} confirmed (demo mode, not persisted).`
          : `Kiln ${r.id} marked as false positive (demo mode, not persisted).`,
    });
  }
  if (r.kind === "add-kiln") {
    const payload = (body || {}) as {
      latitude: number;
      longitude: number;
      technology_type?: string;
      name?: string;
    };
    if (!payload.latitude || !payload.longitude) {
      return NextResponse.json({ error: "Missing latitude/longitude" }, { status: 400 });
    }
    const alert = await demoAddKiln(payload);
    return NextResponse.json(
      { status: "SUCCESS", message: "Kiln added successfully", alert, kiln: alert },
      { headers: NO_STORE },
    );
  }
  if (r.kind === "purge-bogus") {
    return NextResponse.json(
      { status: "SUCCESS", purged_count: 0, remaining_count: (await demoAlerts()).length },
      { headers: NO_STORE },
    );
  }
  if (r.kind === "update-tech") {
    const payload = (body || {}) as { technology_type?: string };
    const ok = await demoUpdateTech(r.id, payload.technology_type || "FCBTK");
    if (!ok) return NextResponse.json({ status: "ERROR", message: "Kiln not found" }, { status: 404 });
    return NextResponse.json({ status: "SUCCESS", message: `Kiln ${r.id} technology updated.` }, { headers: NO_STORE });
  }
  return NextResponse.json(
    { status: "DEMO_MODE", message: "Live scans need the Python backend. Set BACKEND_URL." },
    { status: 503 },
  );
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(_req: Request, ctx: Ctx) {
  const r = match("GET", (await ctx.params).path);
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return backendUrl() ? proxy(r, "GET") : demoGet(r);
}

export async function POST(req: Request, ctx: Ctx) {
  const r = match("POST", (await ctx.params).path);
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Administrative mutations (confirm, reject, scan) require inspector authentication.
  // Adding a kiln directly from the map or updating its tech is accessible to users.
  if (r.kind !== "add-kiln" && r.kind !== "update-tech") {
    const denied = await guardMutation(req);
    if (denied) return denied;
  }

  let body: unknown;
  if (r.kind === "trigger-scan") {
    const payload = (await req.json().catch(() => ({}))) as {
      sector?: string;
      bbox?: unknown;
      max_sectors?: number;
    };
    const sector = payload.sector ?? "ALL";
    body = { sector, bbox: payload.bbox, max_sectors: payload.max_sectors };
  } else if (r.kind === "add-kiln" || r.kind === "update-tech") {
    body = await req.json().catch(() => ({}));
  }
  return backendUrl() ? proxy(r, "POST", body) : demoPost(r, body);
}


