"use client";

import { useState } from "react";
import type { ScanTarget, SystemStatus } from "@/lib/types";
import { DISTRICTS_13 } from "@/lib/types";
import { IconRadar, IconStop } from "./icons";

interface Props {
  status: SystemStatus | null;
  live: boolean;
  onTrigger: (target: ScanTarget) => void;
  onStop?: () => void;
}

/** Compact scan control that lives in the top bar. */
export default function ScannerHud({ status, live, onTrigger, onStop }: Props) {
  const [selectedTarget, setSelectedTarget] = useState<ScanTarget>("ALL");
  const sc = status?.scanner_status;
  const scanning = Boolean(sc?.is_scanning);
  const targetLabel = selectedTarget === "ALL" ? "all 13 districts" : selectedTarget;
  const summary = sc?.last_scan_summary;

  return (
    <div className="scan-control">
      <div className="scan-last" title={summary || undefined}>
        <span className="scan-last-label">Last scan</span>
        <strong>{status?.last_updated_time ?? "Ready"}</strong>
      </div>

      <select
        className="scan-select"
        aria-label="Scan target"
        value={selectedTarget}
        onChange={(e) => setSelectedTarget(e.target.value as ScanTarget)}
        disabled={scanning || !live}
      >
        <option value="ALL">All 13 districts</option>
        {DISTRICTS_13.map((d) => (
          <option key={d} value={d}>
            {d} district
          </option>
        ))}
        <option value="Savar">Savar sector</option>
        <option value="Keraniganj">Keraniganj sector</option>
        <option value="Nawabganj">Nawabganj sector</option>
      </select>

      <button
        className={`btn-primary scan-btn${scanning ? " scanning" : ""}`}
        onClick={() => onTrigger(selectedTarget)}
        disabled={!live || scanning}
        title={
          live
            ? scanning
              ? "Fetching Esri tiles and running YOLOv8 detection"
              : `Fetch fresh satellite imagery and scan ${targetLabel}`
            : "Scanning is only available in live mode"
        }
      >
        <IconRadar className={scanning ? "spin" : undefined} />
        <span>{scanning ? "Scanning…" : "Run Scan"}</span>
      </button>

      {scanning && onStop && (
        <button
          className="btn-stop-scan"
          onClick={onStop}
          title="Stop current satellite scan"
          aria-label="Stop satellite scan"
        >
          <IconStop width={13} height={13} />
          <span>Stop</span>
        </button>
      )}
    </div>
  );
}
