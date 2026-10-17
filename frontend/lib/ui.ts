import type { Alert, Tier } from "@/lib/types";

export const TIER_COLOR: Record<Tier, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f59e0b",
  COMPLIANT: "#10b981",
};

export const TIER_LABEL: Record<Tier, string> = {
  CRITICAL: "CRITICAL (<500 m)",
  HIGH: "HIGH (<1 km)",
  COMPLIANT: "COMPLIANT",
};

export type TechClass = "FCBTK" | "ZIGZAG" | "HOFFMAN";

export function techClass(a: Alert): TechClass {
  const t = (a.technology.type || "FCBTK").toUpperCase();
  if (t.includes("HOFFMAN")) return "HOFFMAN";
  if (t.includes("ZIGZAG")) return "ZIGZAG";
  return "FCBTK";
}

export function evidenceUrl(a: Alert): string | null {
  const p = a.evidence_image?.replace(/\\/g, "/");
  if (!p) return null;
  if (/^https?:\/\//.test(p)) return p;
  return "/" + p.replace(/^\/+/, "");
}

export function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/** Share of the 1,000 m statutory buffer that is still "free" (0–100). */
export function bufferPct(m: number): number {
  return Math.max(0, Math.min(100, (m / 1000) * 100));
}
