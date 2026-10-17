import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const SESSION_COOKIE = "bk_session";
export const SESSION_TTL_SEC = 60 * 60 * 12;

const enc = new TextEncoder();

export function authEnabled(): boolean {
  return Boolean(process.env.INSPECTOR_PASSWORD && process.env.AUTH_SECRET);
}

export function backendUrl(): string {
  return (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.AUTH_SECRET || ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function passwordMatches(candidate: string): boolean {
  return safeEqual(candidate, process.env.INSPECTOR_PASSWORD || "");
}

export async function createSessionToken(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const sig = await hmac(`inspector.${exp}`);
  return `${exp}.${sig}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token || !authEnabled()) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(`inspector.${exp}`));
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export async function isAuthed(req: Request): Promise<boolean> {
  return verifySessionToken(readCookie(req, SESSION_COOKIE));
}

/**
 * Guard for every state-changing endpoint: custom CSRF header + valid
 * inspector session. Returns an error response, or null when allowed.
 */
export async function guardMutation(req: Request): Promise<NextResponse | null> {
  if (req.headers.get("x-bk-csrf") !== "1") {
    return NextResponse.json({ error: "Missing CSRF header" }, { status: 403 });
  }
  if (!authEnabled()) {
    return NextResponse.json(
      { error: "Inspector login is not configured on this server (set INSPECTOR_PASSWORD and AUTH_SECRET)." },
      { status: 403 },
    );
  }
  if (!(await isAuthed(req))) {
    return NextResponse.json({ error: "Inspector login required" }, { status: 401 });
  }
  return null;
}

// --- tiny in-memory login throttle (per server instance) -------------------
const attempts = new Map<string, { count: number; resetAt: number }>();

export function loginThrottled(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  rec.count += 1;
  return rec.count > 5;
}
