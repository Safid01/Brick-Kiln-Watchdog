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
import {
  BrandMark,
  IconAlert,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconClose,
  IconCrosshair,
  IconLayers,
  IconList,
  IconLock,
  IconPlus,
  IconSearch,
  IconShield,
  IconStop,
  IconSun,
  IconMoon,
} from "./icons";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});

type QueueFilter = "SITUATIONS" | "CRITICAL" | "HIGH" | "SAFE" | "FCBTK" | "ALL";

const FILTERS: { id: QueueFilter; label: string; dot?: string }[] = [
  { id: "SITUATIONS", label: "Situations", dot: "#f87171" },
  { id: "CRITICAL", label: "Critical", dot: "#ef4444" },
  { id: "HIGH", label: "High", dot: "#f59e0b" },
  { id: "SAFE", label: "Safe", dot: "#10b981" },
  { id: "FCBTK", label: "FCBTK", dot: "#a855f7" },
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
  const [queueOpen, setQueueOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const layersRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const scrollNav = (direction: "left" | "right") => {
    if (!navRef.current) return;
    const distance = 240;
    navRef.current.scrollBy({ left: direction === "left" ? -distance : distance, behavior: "smooth" });
  };

  const handleNavWheel = (e: React.WheelEvent) => {
    if (!navRef.current) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      navRef.current.scrollLeft += e.deltaY;
    }
  };

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

  // Theme state ("dark" | "light")
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("bk-theme");
      if (saved === "light" || saved === "dark") {
        setTheme(saved);
        document.documentElement.setAttribute("data-theme", saved);
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
      }
    } catch {
      // Storage unavailable or blocked
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    try {
      localStorage.setItem("bk-theme", nextTheme);
    } catch {
      // Storage unavailable
    }
    document.documentElement.setAttribute("data-theme", nextTheme);
  };

  // Live Scan Progress & Time Estimation
  const isScanning = Boolean(status?.scanner_status?.is_scanning);
  const [scanClientPct, setScanClientPct] = useState(6);
  const [scanSecondsRemaining, setScanSecondsRemaining] = useState(35);
  const scanStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isScanning) {
      scanStartRef.current = null;
      setScanClientPct(6);
      return;
    }

    if (!scanStartRef.current) {
      scanStartRef.current = Date.now();
    }

    const interval = setInterval(() => {
      const srvPct = status?.scanner_status?.progress_pct;
      const srvSec = status?.scanner_status?.seconds_remaining;

      if (typeof srvPct === "number" && srvPct > 0) {
        setScanClientPct(srvPct);
      } else if (scanStartRef.current) {
        const elapsedSec = (Date.now() - scanStartRef.current) / 1000;
        const totalEst = 35;
        const pct = Math.min(96, Math.max(8, Math.round((elapsedSec / totalEst) * 100)));
        setScanClientPct(pct);
      }

      if (typeof srvSec === "number" && srvSec > 0) {
        setScanSecondsRemaining(srvSec);
      } else if (scanStartRef.current) {
        const elapsedSec = (Date.now() - scanStartRef.current) / 1000;
        const rem = Math.max(2, Math.round(35 - elapsedSec));
        setScanSecondsRemaining(rem);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isScanning, status?.scanner_status?.progress_pct, status?.scanner_status?.seconds_remaining]);

  const formatEta = (secs: number) => {
    if (secs <= 0) return "Finalizing detection…";
    if (secs >= 60) {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `~${m}m ${s > 0 ? `${s}s` : ""} remaining`;
    }
    return `~${secs}s remaining`;
  };

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

  // --- close the layers popover on outside click / Escape -------------------------
  useEffect(() => {
    if (!layersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (layersRef.current && !layersRef.current.contains(e.target as Node)) setLayersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLayersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [layersOpen]);

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

  const queueAuditedCount = useMemo(() => {
    return regionAlerts.filter(
      (a) => a.human_verification?.status === "CONFIRMED_KILN" || a.human_verification?.status === "FALSE_POSITIVE",
    ).length;
  }, [regionAlerts]);

  const queueTotal = regionAlerts.length;
  const queueAuditPct = queueTotal > 0 ? Math.round((queueAuditedCount / queueTotal) * 100) : 0;

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

  const stopScan = () =>
    requireAuth(async () => {
      notify("Stopping satellite scan…");
      await run(() => api.stopScan(), "Satellite scan stopped.");
    });

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
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <h1>Brick Kiln Watchdog</h1>
            <span>Greater Dhaka · 1 km buffer audit</span>
          </div>
        </div>

        <div className="kpi-strip" aria-label="Summary">
          <Kpi value={status?.total_kilns} label="Mapped" color="var(--text)" />
          <Kpi value={status?.situations_count} label="Situations" className="kpi-situations" />
          <Kpi value={status?.violations_count} label="Buffer breaches" className="kpi-breaches" />
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className={`theme-switch-btn ${theme}`}
            onClick={toggleTheme}
            role="switch"
            aria-checked={theme === "light"}
            aria-label={`Switch to ${theme === "dark" ? "bluish light" : "dark"} mode`}
            title={theme === "dark" ? "Switch to bluish light mode" : "Switch to dark mode"}
          >
            <span className="theme-switch-track">
              <span className="theme-switch-icon theme-switch-moon" aria-hidden="true">
                <IconMoon width={13} height={13} />
              </span>
              <span className="theme-switch-icon theme-switch-sun" aria-hidden="true">
                <IconSun width={13} height={13} />
              </span>
              <span className="theme-switch-thumb" aria-hidden="true" />
            </span>
          </button>

          <span className={`mode-pill ${live ? "live" : "demo"}`}>
            <span className="pulse-dot" />
            {session ? (live ? "Live" : "Demo data") : "…"}
          </span>
          <ScannerHud
            status={status}
            live={Boolean(live)}
            onTrigger={triggerScan}
            onStop={stopScan}
          />
          {session?.authEnabled &&
            (session.authed ? (
              <button className="btn-inspector active" onClick={logout} title="Click to sign out">
                <IconShield />
                <span className="inspector-label">Inspector</span>
                <span className="inspector-signout">Sign out</span>
              </button>
            ) : (
              <button className="btn-inspector" onClick={() => setLoginOpen(true)}>
                <IconLock />
                <span className="inspector-label">Inspector login</span>
              </button>
            ))}
        </div>
      </header>

      <div className="subbar">
        <div className="region-nav-wrap">
          <button
            type="button"
            className="nav-scroll-btn"
            onClick={() => scrollNav("left")}
            aria-label="Scroll left"
            title="Scroll districts left"
          >
            <IconChevronLeft width={13} height={13} />
          </button>
          <nav
            ref={navRef}
            className="region-nav"
            aria-label="District"
            onWheel={handleNavWheel}
          >
            <button
              className={`region-tab${region === "ALL" ? " active" : ""}`}
              aria-pressed={region === "ALL"}
              onClick={() => setRegion("ALL")}
            >
              All <span className="count">{alerts.length}</span>
            </button>
            {REGIONS.map((r) => (
              <button
                key={r}
                className={`region-tab${region === r ? " active" : ""}`}
                aria-pressed={region === r}
                onClick={() => setRegion(r)}
              >
                {r} <span className="count">{regionCounts[r] ?? 0}</span>
              </button>
            ))}
          </nav>
          <button
            type="button"
            className="nav-scroll-btn"
            onClick={() => scrollNav("right")}
            aria-label="Scroll right"
            title="Scroll districts right"
          >
            <IconChevronRight width={13} height={13} />
          </button>
        </div>

        <div className="subbar-right">
          <label className="search-box">
            <IconSearch width={15} height={15} />
            <input
              placeholder="Search kiln ID, school, hospital"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search kilns"
            />
            {query && (
              <button type="button" className="icon-btn" onClick={() => setQuery("")} aria-label="Clear search">
                <IconClose width={13} height={13} />
              </button>
            )}
          </label>

          <div className="layers-wrap" ref={layersRef}>
            <button
              className={`btn-ghost${layersOpen ? " active" : ""}`}
              onClick={() => setLayersOpen((v) => !v)}
              aria-expanded={layersOpen}
            >
              <IconLayers /> <span>Layers</span>
            </button>
            {layersOpen && (
              <div className="layers-pop" role="dialog" aria-label="Map layers">
                <div className="control-title">Basemap</div>
                <div className="basemap-switch">
                  {(
                    [
                      ["satellite", "Satellite"],
                      ["street", "Street"],
                    ] as [Basemap, string][]
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      className={`btn-layer${basemap === id ? " active" : ""}`}
                      onClick={() => setBasemap(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="control-title">Overlays</div>
                <label className="toggle-row">
                  <span>District boundaries</span>
                  <input type="checkbox" checked={showDistricts} onChange={(e) => setShowDistricts(e.target.checked)} />
                </label>
                <label className="toggle-row">
                  <span>1 km buffer rings</span>
                  <input type="checkbox" checked={showBuffers} onChange={(e) => setShowBuffers(e.target.checked)} />
                </label>
                <label className="toggle-row">
                  <span>
                    Schools &amp; hospitals{status ? ` (${status.receptors_count.toLocaleString()})` : ""}
                  </span>
                  <input type="checkbox" checked={showReceptors} onChange={(e) => setShowReceptors(e.target.checked)} />
                </label>
              </div>
            )}
          </div>

          <button
            className={`btn-primary add-kiln${isAddingKiln ? " active" : ""}`}
            onClick={() => {
              setIsAddingKiln((v) => !v);
              setPendingCoord(null);
            }}
          >
            {isAddingKiln ? <IconCrosshair /> : <IconPlus />}
            <span>{isAddingKiln ? "Click the map" : "Add kiln"}</span>
          </button>
        </div>
      </div>

      {offline && (
        <div className="offline-banner" role="alert">
          <IconAlert width={15} height={15} /> {offline}
        </div>
      )}
      {isScanning && (
        <div className="scan-progress-strip" role="status" aria-live="polite">
          <div className="scan-progress-header">
            <div className="scan-progress-title">
              <span className="scan-pulse-dot" />
              <span>
                <strong>Scanning satellite imagery</strong>
                {status?.scanner_status?.current_sector
                  ? ` · ${status.scanner_status.current_sector}`
                  : ""}
                {status?.scanner_status?.total_steps && status.scanner_status.total_steps > 1
                  ? ` (Sector ${status.scanner_status.current_step}/${status.scanner_status.total_steps})`
                  : ""}
              </span>
            </div>
            <div className="scan-progress-metrics">
              <span className="scan-eta">
                <IconClock width={13} height={13} />
                {formatEta(scanSecondsRemaining)}
              </span>
              <span className="scan-pct">{scanClientPct}%</span>
              <button
                type="button"
                className="btn-strip-stop"
                onClick={stopScan}
                title="Stop current satellite scan"
                aria-label="Stop scan"
              >
                <IconStop width={12} height={12} />
                <span>Stop</span>
              </button>
            </div>
          </div>
          <div className="scan-progress-track">
            <div
              className="scan-progress-fill"
              style={{ width: `${Math.min(100, Math.max(3, scanClientPct))}%` }}
            />
          </div>
        </div>
      )}

      <div className={`workspace${queueOpen ? " q-open" : ""}`}>
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
              <IconCrosshair className="pulse-icon" width={20} height={20} />
              <div className="floating-bar-text">
                <strong>Add kiln mode.</strong> Click a spot on the map to place a kiln.
              </div>
              <button
                className="btn-exit-mode"
                onClick={() => {
                  setIsAddingKiln(false);
                  setPendingCoord(null);
                }}
              >
                Exit
              </button>
            </div>
          )}

          <div className="map-legend">
            <Legend color="#ef4444" label="Critical (< 500 m)" />
            <Legend color="#f59e0b" label="High (< 1,000 m)" />
            <Legend color="#10b981" label="Compliant" />
            <Legend color="#a855f7" label="Purple outline: FCBTK (banned)" ring />
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
              <div className="add-kiln-card" role="dialog" aria-label="Add new brick kiln">
                <div className="card-header">
                  <div className="card-title">
                    <h3>Add new brick kiln</h3>
                  </div>
                  <button
                    className="icon-btn"
                    onClick={() => setPendingCoord(null)}
                    disabled={isSubmittingKiln}
                    aria-label="Close"
                  >
                    <IconClose width={16} height={16} />
                  </button>
                </div>

                <div className="card-content">
                  <div className="auto-info-grid">
                    <div className="info-block">
                      <span className="info-label">Coordinates</span>
                      <span className="info-value">
                        {pendingCoord.lat.toFixed(5)}, {pendingCoord.lon.toFixed(5)}
                      </span>
                    </div>
                    <div className="info-block highlight">
                      <span className="info-label">District (auto-detected)</span>
                      <span className="info-value">{detectDistrictName(pendingCoord.lat, pendingCoord.lon)}</span>
                    </div>
                  </div>

                  <div className="tech-picker">
                    <label className="picker-label" htmlFor="pending-tech">
                      Kiln technology
                    </label>
                    <select
                      id="pending-tech"
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
                    className="btn-ghost"
                    onClick={() => setPendingCoord(null)}
                    disabled={isSubmittingKiln}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => handleAddKilnConfirm(pendingTech)}
                    disabled={isSubmittingKiln}
                  >
                    {isSubmittingKiln ? "Adding kiln and generating evidence…" : "Add kiln"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {toast && <div className={`toast${toast.error ? " error" : ""}`}>{toast.text}</div>}
        </main>

        {queueOpen ? (
          <aside className="queue" aria-label="Review queue">
            <div className="queue-head">
              <div>
                <h2>Review queue</h2>
                <p>
                  <strong>{queue.length}</strong>{" "}
                  {filter === "ALL" || filter === "SAFE" ? "kilns shown" : "situations shown"}
                </p>
                <div className="queue-audit-stats-line">
                  <span><strong>{queueAuditedCount} of {queueTotal}</strong> kilns audited</span>
                  <span className="muted"> · {queueTotal - queueAuditedCount} pending</span>
                </div>
              </div>
              <button className="icon-btn queue-collapse" onClick={() => setQueueOpen(false)} aria-label="Hide queue">
                <IconChevronLeft width={18} height={18} />
              </button>
            </div>

            <div className="filters" role="group" aria-label="Filter">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  className={`filter-chip${filter === f.id ? " active" : ""}`}
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.dot && <span className="chip-dot" style={{ background: f.dot }} />}
                  {f.label}
                </button>
              ))}
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
                <div className="empty">
                  {alerts.length === 0 ? "Loading detections…" : "No kilns match these filters. Try another district or filter."}
                </div>
              )}
            </div>
          </aside>
        ) : (
          <button className="queue-open-btn" onClick={() => setQueueOpen(true)}>
            <IconList />
            <span>Review queue</span>
            <span className="count">{queue.length}</span>
          </button>
        )}
      </div>

      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} onSuccess={onLoginSuccess} />}
    </div>
  );
}

function Kpi({
  value,
  label,
  color,
  className = "",
}: {
  value: number | undefined;
  label: string;
  color?: string;
  className?: string;
}) {
  return (
    <div className={`kpi ${className}`}>
      <span className="kpi-val" style={color ? { color } : undefined}>
        {value ?? "–"}
      </span>
      <span className="kpi-lbl">{label}</span>
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
