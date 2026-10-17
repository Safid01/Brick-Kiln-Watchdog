import type {
  Alert,
  BBox,
  DistrictsResponse,
  ReceptorCollection,
  ScanTarget,
  SessionInfo,
  SystemStatus,
} from "@/lib/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface CallOptions {
  method?: "GET" | "POST";
  json?: unknown;
}

async function call<T>(url: string, { method = "GET", json }: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method === "POST") {
    headers["x-bk-csrf"] = "1";
    if (json !== undefined) headers["content-type"] = "application/json";
  }
  const res = await fetch(url, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
    cache: "no-store",
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const d = data as { error?: string; message?: string } | null;
    throw new ApiError(res.status, d?.error || d?.message || `Request failed (${res.status})`);
  }
  return data as T;
}

interface ActionResult {
  status?: string;
  message?: string;
}

export const api = {
  session: () => call<SessionInfo>("/api/session"),
  status: () => call<SystemStatus>("/api/v1/system-status"),
  alerts: () => call<Alert[]>("/api/v1/alerts"),
  receptors: () => call<ReceptorCollection>("/api/v1/receptors"),
  districts: () => call<DistrictsResponse>("/api/v1/districts"),
  confirm: (id: string) => call<ActionResult>(`/api/v1/kilns/${id}/confirm`, { method: "POST" }),
  reject: (id: string) => call<ActionResult>(`/api/v1/kilns/${id}/reject`, { method: "POST" }),
  triggerScan: (sector: ScanTarget = "ALL", bbox?: BBox) =>
    call<ActionResult>("/api/v1/trigger-scan", { method: "POST", json: { sector, bbox } }),
  toggleSweep: () =>
    call<{ auto_sweep_enabled: boolean }>("/api/v1/auto-sweep/toggle", { method: "POST" }),
  addKiln: (payload: { latitude: number; longitude: number; technology_type?: string; name?: string }) =>
    call<{ status: string; message?: string; alert?: Alert; kiln?: Alert; kiln_id?: string }>("/api/v1/kilns/add", {
      method: "POST",
      json: payload,
    }),
  purgeBogus: () =>
    call<{ status: string; purged_count: number; remaining_count: number }>("/api/v1/purge-bogus", {
      method: "POST",
    }),
  updateTechnology: (id: string, technology_type: string) =>
    call<ActionResult>(`/api/v1/kilns/${id}/technology`, {
      method: "POST",
      json: { technology_type },
    }),
  login: (password: string) =>
    call<{ ok: boolean }>("/api/auth/login", { method: "POST", json: { password } }),
  logout: () => call<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
};

