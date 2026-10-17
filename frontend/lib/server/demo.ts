import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  Alert,
  HumanVerification,
  ReceptorCollection,
  SystemStatus,
} from "@/lib/types";
import { isSituation, REGIONS } from "@/lib/types";

/**
 * Demo backend: serves the bundled snapshot (data/alerts.json, data/receptors.json)
 * and keeps confirm / reject decisions in memory only. They reset on restart and
 * are NOT shared between serverless instances — demo use only.
 */
interface DemoState {
  rejected: Set<string>;
  confirmed: Map<string, HumanVerification>;
  version: number;
  alerts?: Alert[];
  receptors?: ReceptorCollection;
}

const g = globalThis as unknown as { __bkDemo?: DemoState };
const state: DemoState = (g.__bkDemo ??= {
  rejected: new Set(),
  confirmed: new Map(),
  version: 0,
});

async function readJson<T>(name: string): Promise<T> {
  const file = path.join(process.cwd(), "data", name);
  return JSON.parse(await fs.readFile(file, "utf-8")) as T;
}

async function baseAlerts(): Promise<Alert[]> {
  return (state.alerts ??= await readJson<Alert[]>("alerts.json"));
}

const TIER_ORDER = { CRITICAL: 0, HIGH: 1, COMPLIANT: 2 } as const;

export async function demoAlerts(): Promise<Alert[]> {
  const list = (await baseAlerts())
    .filter((a) => !state.rejected.has(a.kiln_id))
    .map((a) => {
      const hv = state.confirmed.get(a.kiln_id);
      return hv ? { ...a, human_verification: hv } : a;
    });
  list.sort(
    (a, b) =>
      TIER_ORDER[a.audit_metrics.priority_tier] - TIER_ORDER[b.audit_metrics.priority_tier] ||
      a.audit_metrics.distance_to_receptor_m - b.audit_metrics.distance_to_receptor_m,
  );
  return list;
}

export async function demoReceptors(): Promise<ReceptorCollection> {
  return (state.receptors ??= await readJson<ReceptorCollection>("receptors.json"));
}

export async function demoStatus(): Promise<SystemStatus> {
  const alerts = await demoAlerts();
  const receptors = await demoReceptors();
  const situations = alerts.filter(isSituation).length;

  const tech: Record<string, number> = { FCBTK: 0, ZIGZAG: 0, HOFFMAN: 0 };
  const region: Record<string, number> = Object.fromEntries(REGIONS.map((r) => [r, 0]));
  for (const a of alerts) {
    const t = (a.technology.type || "FCBTK").toUpperCase();
    if (t.includes("HOFFMAN")) tech.HOFFMAN++;
    else if (t.includes("ZIGZAG")) tech.ZIGZAG++;
    else tech.FCBTK++;
    region[a.region] = (region[a.region] ?? 0) + 1;
  }

  const latest = alerts.reduce(
    (m, a) => (a.audit_timestamp > m ? a.audit_timestamp : m),
    "",
  );
  const version = createHash("md5")
    .update(`${alerts.length}-${state.version}`)
    .digest("hex")
    .slice(0, 12);

  return {
    status: "DEMO_SNAPSHOT",
    data_version: version,
    last_updated_time: latest ? new Date(latest).toUTCString() : "—",
    last_updated_iso: latest,
    scanner_status: {
      is_scanning: false,
      last_scan_summary:
        "Demo snapshot. Connect BACKEND_URL to trigger live satellite scans.",
    },
    total_kilns: alerts.length,
    situations_count: situations,
    no_risk_count: alerts.length - situations,
    violations_count: alerts.filter((a) =>
      ["CRITICAL", "HIGH"].includes(a.audit_metrics.priority_tier),
    ).length,
    tech_counts: tech,
    region_counts: region,
    receptors_count: receptors.features.length,
    server_time: new Date().toUTCString(),
  };
}

export async function demoConfirm(id: string): Promise<boolean> {
  if (!(await baseAlerts()).some((a) => a.kiln_id === id) || state.rejected.has(id)) return false;
  state.confirmed.set(id, {
    status: "CONFIRMED_KILN",
    verified_at: new Date().toISOString(),
    verified_by: "Inspector (demo)",
  });
  state.version++;
  return true;
}

export async function demoReject(id: string): Promise<boolean> {
  if (!(await baseAlerts()).some((a) => a.kiln_id === id)) return false;
  state.rejected.add(id);
  state.confirmed.delete(id);
  state.version++;
  return true;
}

export async function demoUpdateTech(id: string, newType: string): Promise<boolean> {
  const alerts = await baseAlerts();
  const a = alerts.find((x) => x.kiln_id === id);
  if (!a) return false;
  const techMap: Record<string, { label: string; badge: string; description: string; compliance_status: string; emission_tier: string; banned: boolean }> = {
    FCBTK: {
      label: "Fixed Chimney Bull's Trench Kiln",
      badge: "FCBTK (Banned)",
      description: "Traditional 120ft fixed chimney kiln with continuous annular trench. High particulate emissions.",
      compliance_status: "BANNED_NON_COMPLIANT",
      emission_tier: "High Particulate (SPM > 1000 mg/Nm³)",
      banned: true,
    },
    ZIGZAG: {
      label: "Improved Zigzag Kiln",
      badge: "Zigzag (Transitional)",
      description: "Forced or induced draft kiln with zigzag airflow path.",
      compliance_status: "TRANSITIONAL",
      emission_tier: "Moderate Particulate (SPM ~ 400 mg/Nm³)",
      banned: false,
    },
    HOFFMAN_TUNNEL: {
      label: "Hoffman / Hybrid Tunnel Kiln",
      badge: "Hoffman/Tunnel",
      description: "Large-scale continuous hybrid tunnel kiln with permanent shed structure.",
      compliance_status: "APPROVED_TECH",
      emission_tier: "Low Particulate (Eco-Approved)",
      banned: false,
    },
  };
  const t = techMap[newType.toUpperCase()] || techMap["FCBTK"];
  a.technology = { type: newType.toUpperCase(), ...t };
  state.version++;
  return true;
}


function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const DISTRICT_BOUNDS: Record<
  string,
  { min_lat: number; max_lat: number; min_lon: number; max_lon: number }
> = {
  Savar: { min_lat: 23.75, max_lat: 23.95, min_lon: 90.2, max_lon: 90.36 },
  Keraniganj: { min_lat: 23.58, max_lat: 23.72, min_lon: 90.28, max_lon: 90.45 },
  Dhaka: { min_lat: 23.53, max_lat: 24.03, min_lon: 90.01, max_lon: 90.58 },
  Gazipur: { min_lat: 23.88, max_lat: 24.35, min_lon: 90.15, max_lon: 90.7 },
  Narayanganj: { min_lat: 23.53, max_lat: 23.82, min_lon: 90.45, max_lon: 90.76 },
  Tangail: { min_lat: 24.01, max_lat: 24.8, min_lon: 89.7, max_lon: 90.3 },
  Narsingdi: { min_lat: 23.77, max_lat: 24.25, min_lon: 90.58, max_lon: 90.92 },
  Manikganj: { min_lat: 23.63, max_lat: 24.05, min_lon: 89.7, max_lon: 90.25 },
  Munshiganj: { min_lat: 23.38, max_lat: 23.68, min_lon: 90.16, max_lon: 90.68 },
  Kishoreganj: { min_lat: 24.04, max_lat: 24.63, min_lon: 90.58, max_lon: 91.18 },
  Faridpur: { min_lat: 23.28, max_lat: 23.92, min_lon: 89.48, max_lon: 90.27 },
  Madaripur: { min_lat: 23.0, max_lat: 23.5, min_lon: 90.0, max_lon: 90.5 },
  Gopalganj: { min_lat: 22.84, max_lat: 23.38, min_lon: 89.73, max_lon: 90.15 },
  Rajbari: { min_lat: 23.55, max_lat: 23.9, min_lon: 89.3, max_lon: 89.92 },
  Shariatpur: { min_lat: 23.13, max_lat: 23.45, min_lon: 90.17, max_lon: 90.62 },
};

export async function demoAddKiln(payload: {
  latitude: number;
  longitude: number;
  technology_type?: string;
  name?: string;
}): Promise<Alert> {
  const { latitude, longitude } = payload;
  let detectedRegion = "Dhaka";
  for (const [r, b] of Object.entries(DISTRICT_BOUNDS)) {
    if (
      latitude >= b.min_lat &&
      latitude <= b.max_lat &&
      longitude >= b.min_lon &&
      longitude <= b.max_lon
    ) {
      detectedRegion = r;
      break;
    }
  }

  // Calculate distance to nearest receptor
  const receptors = await demoReceptors();
  let nearestFacility = "Local Sensitive Receptor";
  let facilityType = "school";
  let minDistanceM = 999999.0;
  let nearestCoords = { latitude, longitude };

  for (const f of receptors.features) {
    const [rLon, rLat] = f.geometry.coordinates;
    const d = haversineM(latitude, longitude, rLat, rLon);
    if (d < minDistanceM) {
      minDistanceM = d;
      nearestFacility = f.properties.name || "Educational / Health Receptor";
      facilityType = f.properties.type || "facility";
      nearestCoords = { latitude: rLat, longitude: rLon };
    }
  }

  const priorityTier =
    minDistanceM < 500 ? "CRITICAL" : minDistanceM < 1000 ? "HIGH" : "COMPLIANT";

  const prefix = detectedRegion.slice(0, 3).toUpperCase();
  const randNum = Math.floor(100 + Math.random() * 900);
  const kilnId = `BK-${prefix}-${randNum}`;

  const techType = payload.technology_type || "FCBTK";
  const techMap: Record<string, { label: string; badge: string; description: string; compliance_status: string; emission_tier: string; banned: boolean }> = {
    FCBTK: {
      label: "Fixed Chimney Bull's Trench Kiln",
      badge: "FCBTK (Banned)",
      description: "Traditional 120ft fixed chimney kiln with continuous annular trench. High particulate emissions.",
      compliance_status: "BANNED_NON_COMPLIANT",
      emission_tier: "High Particulate (SPM > 1000 mg/Nm³)",
      banned: true,
    },
    ZIGZAG: {
      label: "Improved Zigzag Kiln",
      badge: "Zigzag (Transitional)",
      description: "Forced or induced draft kiln with zigzag airflow path.",
      compliance_status: "TRANSITIONAL",
      emission_tier: "Moderate Particulate (SPM ~ 400 mg/Nm³)",
      banned: false,
    },
    HOFFMAN_TUNNEL: {
      label: "Hoffman / Hybrid Tunnel Kiln",
      badge: "Hoffman/Tunnel",
      description: "Large-scale continuous hybrid tunnel kiln with permanent shed structure.",
      compliance_status: "APPROVED_TECH",
      emission_tier: "Low Particulate (Eco-Approved)",
      banned: false,
    },
  };

  const tech = techMap[techType] || techMap["FCBTK"];
  const now = new Date();

  const newAlert: Alert = {
    event: "POTENTIAL_KILN_VIOLATION",
    kiln_id: kilnId,
    region: detectedRegion,
    coordinates: { latitude, longitude },
    technology: {
      type: techType,
      ...tech,
    },
    operational_status: {
      is_active: true,
      state: "OPERATIONAL",
      label: "Kiln Facility",
      plume_opacity_pct: 0,
    },
    dimensions: {
      length_m: 85.0,
      width_m: 48.0,
      aspect_ratio: 1.77,
      area_sqm: 4080.0,
      estimated_capacity: 89760,
    },
    audit_metrics: {
      confidence: 0.99,
      estimated_length_m: 85.0,
      estimated_width_m: 48.0,
      distance_to_receptor_m: Math.round(minDistanceM * 10) / 10,
      nearest_receptor: nearestFacility,
      receptor_type: facilityType,
      priority_tier: priorityTier as "CRITICAL" | "HIGH" | "COMPLIANT",
      nearest_receptor_coords: nearestCoords,
    },
    statutory_basis: "Brick Manufacturing and Kiln Construction (Control) Act - 1,000m Buffer Mandate",
    evidence_image: `evidence/${kilnId}_patch.jpg`,
    audit_timestamp: now.toISOString(),
    audit_date_formatted: now.toUTCString(),
    status: "REQUIRES_HUMAN_VERIFICATION",
    human_verification: {
      status: "CONFIRMED_KILN",
      verified_at: now.toISOString(),
      verified_by: "Inspector (User Map Placement)",
    },
  };

  const currentAlerts = await baseAlerts();
  currentAlerts.unshift(newAlert);
  state.version++;
  return newAlert;
}

