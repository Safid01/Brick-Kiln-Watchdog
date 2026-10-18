export type Tier = "CRITICAL" | "HIGH" | "COMPLIANT";

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface HumanVerification {
  status: "CONFIRMED_KILN" | "FALSE_POSITIVE";
  verified_at?: string;
  flagged_at?: string;
  verified_by?: string;
  flagged_by?: string;
}

export interface Alert {
  event: string;
  kiln_id: string;
  region: string;
  coordinates: LatLon;
  technology: {
    type: string;
    label: string;
    badge: string;
    description?: string;
    compliance_status?: string;
    emission_tier?: string;
    banned: boolean;
  };
  operational_status: {
    is_active: boolean;
    state: string;
    label: string;
    plume_opacity_pct: number;
    thermal_signature?: string;
    haze_coefficient?: number;
  };
  dimensions: {
    length_m: number;
    width_m: number;
    aspect_ratio: number;
    area_sqm: number;
    estimated_capacity: number;
  };
  audit_metrics: {
    confidence: number;
    estimated_length_m?: number;
    estimated_width_m?: number;
    distance_to_receptor_m: number;
    nearest_receptor: string;
    receptor_type: string;
    priority_tier: Tier;
    nearest_receptor_coords?: Partial<LatLon>;
  };
  statutory_basis?: string;
  evidence_image?: string;
  audit_timestamp: string;
  audit_date_formatted?: string;
  status: string;
  human_verification?: HumanVerification;
}

export interface ScannerStatus {
  is_scanning: boolean;
  last_scan_summary: string;
  progress_pct?: number;
  current_step?: number;
  total_steps?: number;
  seconds_remaining?: number;
  current_sector?: string;
}

export interface SystemStatus {
  status: string;
  data_version: string;
  last_updated_time: string;
  last_updated_iso: string;
  scanner_status: ScannerStatus;
  total_kilns: number;
  situations_count: number;
  no_risk_count: number;
  violations_count: number;
  tech_counts: Record<string, number>;
  region_counts: Record<string, number>;
  receptors_count: number;
  server_time: string;
}

export interface ReceptorFeature {
  type: "Feature";
  properties: { name: string; type: string; region?: string };
  geometry: { type: "Point"; coordinates: [number, number] };
}

export interface ReceptorCollection {
  type: "FeatureCollection";
  features: ReceptorFeature[];
}

export interface SessionInfo {
  mode: "live" | "demo";
  authEnabled: boolean;
  authed: boolean;
}

export interface BBox {
  min_lat: number;
  min_lon: number;
  max_lat: number;
  max_lon: number;
}

export interface DistrictInfo {
  name: string;
  prefix: string;
  bbox: BBox;
  description: string;
}

export interface DistrictsResponse {
  division: string;
  total_districts: number;
  macro_bbox: BBox;
  districts: Record<string, DistrictInfo>;
  sectors: Array<{
    region: string;
    district?: string;
    prefix: string;
    name: string;
    bbox: BBox;
  }>;
}

export const DISTRICTS_13 = [
  "Dhaka",
  "Gazipur",
  "Narayanganj",
  "Tangail",
  "Narsingdi",
  "Manikganj",
  "Munshiganj",
  "Faridpur",
  "Kishoreganj",
  "Gopalganj",
  "Madaripur",
  "Rajbari",
  "Shariatpur",
] as const;

export const REGIONS = [
  "Dhaka",
  "Gazipur",
  "Narayanganj",
  "Tangail",
  "Narsingdi",
  "Manikganj",
  "Munshiganj",
  "Faridpur",
  "Kishoreganj",
  "Gopalganj",
  "Madaripur",
  "Rajbari",
  "Shariatpur",
  "Savar",
  "Keraniganj",
  "Nawabganj",
] as const;

export const SCAN_TARGETS = [
  "ALL",
  ...DISTRICTS_13,
  "Savar",
  "Keraniganj",
  "Nawabganj",
  "RECEPTORS",
] as const;
export type ScanTarget = (typeof SCAN_TARGETS)[number];

/** A kiln "needs attention" if it breaches the 1,000 m buffer or is a banned FCBTK. */
export function isSituation(a: Alert): boolean {
  return (
    a.audit_metrics.priority_tier === "CRITICAL" ||
    a.audit_metrics.priority_tier === "HIGH" ||
    (a.technology.type || "").toUpperCase().includes("FCBTK")
  );
}
