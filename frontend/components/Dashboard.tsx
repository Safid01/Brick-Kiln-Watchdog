"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import {
  REGIONS,
  isSituation,
  type Alert,
  type ReceptorCollection,
  type ScanTarget,
  type SessionInfo,
  type SystemStatus,
} from "@/lib/types";
import AlertCard from "./AlertCard";
import DetailPanel from "./DetailPanel";
import LoginDialog from "./LoginDialog";
import ScannerHud from "./ScannerHud";
import { detectDistrictName } from "@/lib/districts";
import type { Basemap } from "./MapView";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});

type QueueFilter = "SITUATIONS" | "CRITICAL" | "HIGH" | "SAFE" | "FCBTK" | "ALL";

const FILTERS: { id: QueueFilter; label: string }[] = [
  { id: "SITUATIONS", label: "⚠️ Situations" },
  { id: "CRITICAL", label: "🔴 Critical" },
  { id: "HIGH", label: "🟠 High" },
  { id: "SAFE", label: "🟢 Safe" },
  { id: "FCBTK", label: "🏭 FCBTK" },
  { id: "ALL", label: "All kilns" },
];

function matchesFilter(a: Alert, f: QueueFilter): boolean {
  switch (f) {
    case "SITUATIONS":
      return isSituation(a);
    case "CRITICAL":
      return a.audit_metrics.priority_tier === "CRITICAL";
    case "HIGH":
      return a.audit_metrics.priority_tier === "HIGH";
    case "SAFE":
      return a.audit_metrics.priority_tier === "COMPLIANT";
    case "FCBTK":
      return (a.technology.type || "").toUpperCase().includes("FCBTK");
    case "ALL":
      return true;
    default:
      return true;
  }
}



interface ToastMsg {
  text: string;
  error: boolean;
}

export default function Dashboard() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [receptors, setReceptors] = useState<ReceptorCollection | null>(null);
  const [offline, setOffline] = useState<string | null>(null);

  const [region, setRegion] = useState<string>("ALL");
  const [filter, setFilter] = useState<QueueFilter>("SITUATIONS");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [showBuffers, setShowBuffers] = useState(false);
  const [showReceptors, setShowReceptors] = useState(false);
  const [showDistricts, setShowDistricts] = useState(true);

  // Add Kiln Interactive State
  const [isAddingKiln, setIsAddingKiln] = useState(false);
  const [pendingCoord, setPendingCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [pendingTech, setPendingTech] = useState("FCBTK");
  const [isSubmittingKiln, setIsSubmittingKiln] = useState(false);

  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const dataVersion = useRef("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refreshAlerts = useCallback(async () => {
    setAlerts(await api.alerts());
  }, []);

  // --- session ---------------------------------------------------------------
  useEffect(() => {
    api.session().then(setSession).catch(() => setSession(null));
  }, []);

  // --- live polling: cheap status every 3 s, full alerts only when data changed --
  useEffect(() => {
    let stopped = false;
    let consecutiveErrors = 0;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const s = await api.status();
        if (stopped) return;
        consecutiveErrors = 0;
        setStatus(s);
        setOffline(null);
        if (s.data_version !== dataVersion.current) {
          dataVersion.current = s.data_version;
          await refreshAlerts();
        }
      } catch (e) {
        consecutiveErrors++;
        if (!stopped && consecutiveErrors >= 3) {
          setOffline(e instanceof Error ? e.message : "Backend unreachable");
        }
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [refreshAlerts]);

  // --- receptors: fetched lazily the first time the layer is switched on ----------
  useEffect(() => {
    if (!showReceptors || receptors) return;
    api
      .receptors()
      .then(setReceptors)
      .catch((e: unknown) => notify(e instanceof Error ? e.message : "Could not load receptors", true));
  }, [showReceptors, receptors, notify]);

  // --- derived lists ----------------------------------------------------------
  const regionAlerts = useMemo(
    () => (region === "ALL" ? alerts : alerts.filter((a) => a.region === region)),
    [alerts, region],
  );

  const queue = useMemo(() => {
    const q = query.trim().toLowerCase();
    return regionAlerts.filter(
      (a) =>
        matchesFilter(a, filter) &&
        (!q ||
          a.kiln_id.toLowerCase().includes(q) ||
          a.audit_metrics.nearest_receptor.toLowerCase().includes(q) ||
          a.region.toLowerCase().includes(q)),
    );
  }, [regionAlerts, filter, query]);

  const regionCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of alerts) c[a.region] = (c[a.region] ?? 0) + 1;
    return c;
  }, [alerts]);

  const selected = useMemo(
    () => alerts.find((a) => a.kiln_id === selectedId) ?? null,
    [alerts, selectedId],
  );

  useEffect(() => {
    if (selectedId) {
      if (!queue.some((a) => a.kiln_id === selectedId)) {
        setSelectedId(null);
      } else {
        document.getElementById(`card-${selectedId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedId, queue]);

  // --- inspector actions (login-gated) ---------------------------------------------
  const requireAuth = useCallback(
    (fn: () => void) => {
      if (session && !session.authEnabled) {
        notify("Inspector login is not configured on this server.", true);
        return;
      }
      if (!session?.authed) {
        pendingAction.current = fn;
        setLoginOpen(true);
        return;
      }
      fn();
    },
    [session, notify],
  );

  const run = useCallback(
    async (fn: () => Promise<{ message?: string } | void>, fallback = "Done") => {
      try {
        const r = await fn();
        notify((r && r.message) || fallback);
        await refreshAlerts();
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setSession((s) => (s ? { ...s, authed: false } : s));
          notify("Session expired. Please sign in again.", true);
        } else {
          notify(e instanceof Error ? e.message : "Action failed", true);
        }
        return false;
      }
    },
    [notify, refreshAlerts],
  );

  const confirmKiln = (id: string) => requireAuth(() => void run(() => api.confirm(id)));

  const rejectKiln = (id: string) =>
    requireAuth(() => {
      if (!window.confirm(`Mark ${id} as a false alarm? It will be permanently excluded from all future satellite scans and removed from the map.`)) return;
      void run(() => api.reject(id)).then((ok) => {
        if (ok) setSelectedId((s) => (s === id ? null : s));
      });
    });

  const triggerScan = (target: ScanTarget = "ALL") =>
    requireAuth(() => void run(() => api.triggerScan(target)));

  const handleMapClickCoord = useCallback((lat: number, lon: number) => {
    setPendingCoord({ lat, lon });
  }, []);

  const handleUpdateTechnology = useCallback(
    async (id: string, newType: string) => {
      try {
        await api.updateTechnology(id, newType);
        notify(`Kiln ${id} updated to ${newType}.`);
        await refreshAlerts();
      } catch (err) {
        notify(err instanceof Error ? err.message : "Failed to update kiln type", true);
      }
    },
    [notify, refreshAlerts],
  );

  const handleAddKilnConfirm = useCallback(
    async (techType: string = "FCBTK") => {
      if (!pendingCoord) return;
      setIsSubmittingKiln(true);
      try {
        const res = await api.addKiln({
          latitude: pendingCoord.lat,
          longitude: pendingCoord.lon,
          technology_type: techType,
        });
        const newKiln = res.alert || res.kiln;
        const kid = newKiln?.kiln_id || res.kiln_id || "new kiln";
        notify(`Kiln ${kid} added successfully.`);
        setFilter("ALL");
        await refreshAlerts();
        if (newKiln?.kiln_id) {
          setSelectedId(newKiln.kiln_id);
        }
        setIsAddingKiln(false);
        setPendingCoord(null);
      } catch (err) {
        notify(err instanceof Error ? err.message : "Failed to add kiln", true);
      } finally {
        setIsSubmittingKiln(false);
      }
    },
    [pendingCoord, notify, refreshAlerts],
  );

  async function onLoginSuccess() {
    setSession(await api.session());
    setLoginOpen(false);
    const fn = pendingAction.current;
    pendingAction.current = null;
    fn?.();
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    setSession(await api.session());
    notify("Signed out.");
  }

  const live = session?.mode === "live";

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="header">
          <div className="header-top">
            <span className={`mode-pill ${live ? "live" : "demo"}`}>
              <span className="pulse-dot" />
              {session ? (live ? "LIVE MONITORING" : "DEMO DATA") : "…"}
            </span>
            <div className="header-right">
              {session?.authEnabled &&
                (session.authed ? (
                  <button className="btn-inspector-active" onClick={logout} title="Click to sign out">
                    <span>🛡️ Inspector Active</span>
                    <span style={{ fontSize: "0.68rem", opacity: 0.8 }}>(Sign out)</span>
                  </button>
                ) : (
                  <button className="btn-inspector-login" onClick={() => setLoginOpen(true)}>
                    🔐 Inspector login
                  </button>
                ))}
            </div>
          </div>
          <h1>🛰️ Brick Kiln Watchdog</h1>
          <ScannerHud status={status} live={Boolean(live)} onTrigger={triggerScan} />
        </header>

        {offline && <div className="offline-banner">⚠️ {offline}</div>}

        <section className="kpis">
          <Kpi value={status?.total_kilns} label="Total mapped" color="var(--cyan)" />
          <Kpi value={status?.situations_count} label="Situations" color="#f87171" />
          <Kpi value={status?.violations_count} label="Buffer breaches" color="var(--warning)" />
        </section>

        <nav className="tabs">
          <button className={`tab${region === "ALL" ? " active" : ""}`} onClick={() => setRegion("ALL")}>
            All ({alerts.length})
          </button>
          {REGIONS.map((r) => (
            <button key={r} className={`tab${region === r ? " active" : ""}`} onClick={() => setRegion(r)}>
              {r} ({regionCounts[r] ?? 0})
            </button>
          ))}
        </nav>

        <div className="filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`filter-btn${filter === f.id ? " active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="search-row">
          <input
            className="search-input"
            placeholder="Search kiln ID, school, hospital…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="icon-btn" onClick={() => setQuery("")} aria-label="Clear search">
              ✕
            </button>
          )}
        </div>

        <div className="queue-banner">
          <span>
            📋 <strong>{queue.length}</strong> {filter === "ALL" || filter === "SAFE" ? "kilns shown" : "situations shown"}
          </span>
        </div>

        <div className="list">
          {queue.map((a) => (
            <AlertCard
              key={a.kiln_id}
              alert={a}
              selected={a.kiln_id === selectedId}
              onSelect={() => setSelectedId(a.kiln_id)}
              onConfirm={() => confirmKiln(a.kiln_id)}
              onReject={() => rejectKiln(a.kiln_id)}
            />
          ))}
          {queue.length === 0 && (
            <div className="empty">{alerts.length === 0 ? "Loading detections…" : "No kilns match these filters."}</div>
          )}
        </div>
      </aside>

      <main className="map-wrapper">
        <MapView
          alerts={queue}
          selectedId={selectedId}
          onSelect={setSelectedId}
          basemap={basemap}
          showBuffers={showBuffers}
          showReceptors={showReceptors}
          showDistricts={showDistricts}
          onSelectDistrict={(dist) => setRegion(dist)}
          receptors={receptors}
          isAddingKiln={isAddingKiln}
          onMapClickCoord={handleMapClickCoord}
          pendingCoord={pendingCoord}
        />

        {isAddingKiln && (
          <div className="add-kiln-floating-bar">
            <span className="pulse-icon">🎯</span>
            <div className="floating-bar-text">
              <strong>Add Kiln Mode Active:</strong> Click directly on any place on the satellite map to add a kiln.
            </div>
            <button
              className="btn-exit-mode"
              onClick={() => {
                setIsAddingKiln(false);
                setPendingCoord(null);
              }}
            >
              ✕ Exit Mode
            </button>
          </div>
        )}

        <div className="map-controls">
          <div className="map-add-action-box">
            <button
              className={`btn-add-kiln-toggle${isAddingKiln ? " active" : ""}`}
              onClick={() => {
                setIsAddingKiln((v) => !v);
                setPendingCoord(null);
              }}
            >
              {isAddingKiln ? "🎯 Click Map to Place Kiln" : "➕ Add Kiln to Map"}
            </button>
          </div>

          <div className="control-title">Basemap &amp; Surveillance Overlays</div>
          <div className="basemap-switch">
            {(
              [
                ["satellite", "🛰️ Satellite"],
                ["street", "🗺️ Street"],
              ] as [Basemap, string][]
            ).map(([id, label]) => (
              <button key={id} className={`btn-layer${basemap === id ? " active" : ""}`} onClick={() => setBasemap(id)}>
                {label}
              </button>
            ))}
          </div>
          <label className="toggle-row">
            <span>📐 13 District Bounding Boxes</span>
            <input type="checkbox" checked={showDistricts} onChange={(e) => setShowDistricts(e.target.checked)} />
          </label>
          <label className="toggle-row">
            <span>⭕ 1 km buffer rings</span>
            <input type="checkbox" checked={showBuffers} onChange={(e) => setShowBuffers(e.target.checked)} />
          </label>
          <label className="toggle-row">
            <span>🏫 Schools &amp; hospitals{status ? ` (${status.receptors_count.toLocaleString()})` : ""}</span>
            <input type="checkbox" checked={showReceptors} onChange={(e) => setShowReceptors(e.target.checked)} />
          </label>
        </div>

        <div className="map-legend">
          <Legend color="#ef4444" label="Critical (< 500 m)" />
          <Legend color="#f59e0b" label="High (< 1,000 m)" />
          <Legend color="#10b981" label="Compliant" />
          <Legend color="#a855f7" label="Purple outline = FCBTK (banned)" ring />
        </div>

        {selected && (
          <DetailPanel
            alert={selected}
            onClose={() => setSelectedId(null)}
            onConfirm={() => confirmKiln(selected.kiln_id)}
            onReject={() => rejectKiln(selected.kiln_id)}
            onUpdateTechnology={handleUpdateTechnology}
          />
        )}

        {pendingCoord && (
          <div className="add-kiln-modal-overlay">
            <div className="add-kiln-card">
              <div className="card-header">
                <div className="card-title">
                  <span className="badge-icon">🏭</span>
                  <h3>Add New Brick Kiln</h3>
                </div>
                <button
                  className="close-btn"
                  onClick={() => setPendingCoord(null)}
                  disabled={isSubmittingKiln}
                >
                  ✕
                </button>
              </div>

              <div className="card-content">
                <div className="auto-info-grid">
                  <div className="info-block">
                    <span className="info-label">📍 Selected Coordinates</span>
                    <span className="info-value">
                      {pendingCoord.lat.toFixed(5)}, {pendingCoord.lon.toFixed(5)}
                    </span>
                  </div>
                  <div className="info-block highlight">
                    <span className="info-label">🏛️ Auto-Detected District</span>
                    <span className="info-value">
                      📍 {detectDistrictName(pendingCoord.lat, pendingCoord.lon)}
                    </span>
                  </div>
                </div>

                <div className="tech-picker">
                  <label className="picker-label">Kiln Technology Type</label>
                  <select
                    className="tech-dropdown"
                    value={pendingTech}
                    onChange={(e) => setPendingTech(e.target.value)}
                    disabled={isSubmittingKiln}
                  >
                    <option value="FCBTK">Fixed Chimney Bull&apos;s Trench Kiln (FCBTK - Banned)</option>
                    <option value="ZIGZAG">Improved Zigzag Kiln (Transitional)</option>
                    <option value="HOFFMAN_TUNNEL">Hoffman / Hybrid Tunnel Kiln (Eco-Approved)</option>
                  </select>
                </div>
              </div>

              <div className="card-actions">
                <button
                  className="btn-cancel"
                  onClick={() => setPendingCoord(null)}
                  disabled={isSubmittingKiln}
                >
                  Cancel
                </button>
                <button
                  className="btn-submit-kiln"
                  onClick={() => handleAddKilnConfirm(pendingTech)}
                  disabled={isSubmittingKiln}
                >
                  {isSubmittingKiln ? "🛰️ Adding Kiln & Generating Evidence…" : "✅ Confirm & Add Kiln"}
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && <div className={`toast${toast.error ? " error" : ""}`}>{toast.text}</div>}
      </main>

      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} onSuccess={onLoginSuccess} />}
    </div>
  );
}

function Kpi({ value, label, color }: { value: number | undefined; label: string; color: string }) {
  return (
    <div className="kpi">
      <div className="kpi-val" style={{ color }}>
        {value ?? "–"}
      </div>
      <div className="kpi-lbl">{label}</div>
    </div>
  );
}

function Legend({ color, label, ring }: { color: string; label: string; ring?: boolean }) {
  return (
    <div className="legend-item">
      <span
        className="legend-dot"
        style={ring ? { border: `2px solid ${color}`, background: "transparent" } : { background: color }}
      />
      {label}
    </div>
  );
}
