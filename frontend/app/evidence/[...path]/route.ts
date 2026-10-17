import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { backendUrl } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

// Only evidence crops produced by the detector are served — nothing else on disk.
const FILE = /^BK-[A-Z]{2,3}-\d{3,4}_patch\.jpg$/;

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(_req: Request, ctx: Ctx) {
  const segs = (await ctx.params).path;
  if (segs.length !== 1 || !FILE.test(segs[0])) {
    return new NextResponse("Not found", { status: 404 });
  }
  const name = segs[0];

  // Live mode: stream the crop from the FastAPI backend (read at runtime).
  if (backendUrl()) {
    try {
      const res = await fetch(`${backendUrl()}/evidence/${name}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return new NextResponse("Not found", { status: res.status === 404 ? 404 : 502 });
      return new NextResponse(res.body, {
        headers: {
          "content-type": res.headers.get("content-type") || "image/jpeg",
          "cache-control": "public, max-age=300",
        },
      });
    } catch {
      return new NextResponse("Backend unreachable", { status: 502 });
    }
  }

  // Demo mode: bundled snapshot crops.
  try {
    const buf = await fs.readFile(path.join(process.cwd(), "data", "evidence", name));
    return new NextResponse(new Uint8Array(buf), {
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
