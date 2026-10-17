"use client";

import { useState } from "react";
import type { ScanTarget, SystemStatus } from "@/lib/types";
import { DISTRICTS_13 } from "@/lib/types";

interface Props {
  status: SystemStatus | null;
  live: boolean;
  onTrigger: (target: ScanTarget) => void;
}

export default function ScannerHud({ status, live, onTrigger }: Props) {
  const [selectedTarget, setSelectedTarget] = useState<ScanTarget>("ALL");
  const sc = status?.scanner_status;
  const scanning = Boolean(sc?.is_scanning);

  return (
    <div className="hud">
      <div className="hud-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <div>
          <span className="hud-label">🕒 Last audit: </span>
          <strong className="hud-clock">{status?.last_updated_time ?? "Ready"}</strong>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Target:</span>
          <select
            value={selectedTarget}
            onChange={(e) => setSelectedTarget(e.target.value as ScanTarget)}
            disabled={scanning || !live}
            style={{
              background: "#101827",
              color: "#38bdf8",
              border: "1px solid #1e293b",
              borderRadius: "6px",
              padding: "0.2rem 0.5rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            <option value="ALL">🌐 All 13 Districts</option>
            {DISTRICTS_13.map((d) => (
              <option key={d} value={d}>
                📍 {d} District
              </option>
            ))}
            <option value="Savar">📍 Savar Sector</option>
            <option value="Keraniganj">📍 Keraniganj Sector</option>
            <option value="Nawabganj">📍 Nawabganj Sector</option>
          </select>
        </div>
      </div>

      <button
        className={`btn-scan-main${scanning ? " scanning" : ""}`}
        onClick={() => onTrigger(selectedTarget)}
        disabled={!live || scanning}
        title={live ? `Fetch fresh satellite imagery and audit ${selectedTarget === "ALL" ? "all 13 districts" : selectedTarget}` : "Demo mode"}
      >
        <span className="scan-icon">{scanning ? "⏳" : "🛰️"}</span>
        <span className="scan-text">
          <strong>{scanning ? "SURVEILLANCE SCAN IN PROGRESS..." : `AUDIT ${selectedTarget === "ALL" ? "ALL 13 DISTRICTS" : selectedTarget.toUpperCase()}`}</strong>
          <small>{scanning ? "Fetching Esri tiles & running YOLOv8 detection" : "Live high-res imagery & sliding-window detection"}</small>
        </span>
      </button>

      {sc?.last_scan_summary && (
        <div className="hud-summary muted small" style={{ marginTop: "0.4rem" }}>{sc.last_scan_summary}</div>
      )}
    </div>
  );
}
