"use client";

import { useState } from "react";
import type { Alert } from "@/lib/types";
import { TIER_LABEL, bufferPct, evidenceUrl, fmtDistance } from "@/lib/ui";
import { IconCheck, IconClose } from "./icons";

interface Props {
  alert: Alert;
  onClose: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onUpdateTechnology?: (id: string, technology_type: string) => void;
}

export default function DetailPanel({
  alert: a,
  onClose,
  onConfirm,
  onReject,
  onUpdateTechnology,
}: Props) {
  const tier = a.audit_metrics.priority_tier;
  const img = evidenceUrl(a);
  const hv = a.human_verification;
  const [brokenFor, setBrokenFor] = useState<string | null>(null);
  const imgBroken = brokenFor === a.kiln_id;

  return (
    <aside className={`detail-panel status-${tier}`} aria-label={`Details for ${a.kiln_id}`}>
      <div className="detail-head">
        <div>
          <div className="card-id">{a.kiln_id}</div>
          <div className="muted small">
            {a.region} · {a.coordinates.latitude.toFixed(5)}, {a.coordinates.longitude.toFixed(5)}
          </div>
        </div>
        <div className="detail-head-right">
          <span className={`badge badge-${tier}`}>{TIER_LABEL[tier]}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close details">
            <IconClose width={16} height={16} />
          </button>
        </div>
      </div>

      {img && !imgBroken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="detail-img"
          src={img}
          alt={`Evidence crop for ${a.kiln_id}`}
          onError={() => setBrokenFor(a.kiln_id)}
        />
      ) : (
        <div className="detail-img thumb-missing">No evidence image for this kiln yet</div>
      )}

      <div className="detail-receptor">
        <div className="muted small">Nearest protected facility</div>
        <div className="detail-receptor-name">{a.audit_metrics.nearest_receptor}</div>
        <div className="distance-line">
          <span className="muted">{a.audit_metrics.receptor_type} · distance</span>
          <span className={`distance-val ${tier === "COMPLIANT" ? "safe" : "breach"}`}>
            {fmtDistance(a.audit_metrics.distance_to_receptor_m)}
          </span>
        </div>
        <div className={`buffer-progress status-${tier}`}>
          <div className="buffer-bar" style={{ width: `${bufferPct(a.audit_metrics.distance_to_receptor_m)}%` }} />
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="Model confidence" value={`${(a.audit_metrics.confidence * 100).toFixed(1)}%`} />
        <Stat label="Facility status" value={a.operational_status.state || "OPERATIONAL"} />
      </div>

      <div className="detail-meta-box">
        <label className="meta-label" htmlFor="tech-select">
          Kiln technology
        </label>
        <select
          id="tech-select"
          className="detail-tech-select"
          value={a.technology.type || "FCBTK"}
          onChange={(e) => onUpdateTechnology?.(a.kiln_id, e.target.value)}
        >
          <option value="FCBTK">FCBTK (Fixed Chimney - Banned)</option>
          <option value="ZIGZAG">Improved Zigzag (Transitional)</option>
          <option value="HOFFMAN_TUNNEL">Hoffman / Hybrid Tunnel (Approved)</option>
        </select>
      </div>

      <div className="muted small">
        Audited {a.audit_date_formatted ?? a.audit_timestamp}
        {hv && (
          <>
            {" · "}
            <strong>{hv.status === "CONFIRMED_KILN" ? "Confirmed by inspector" : "Flagged false positive"}</strong>
          </>
        )}
      </div>
      <div className="disclaimer">AI-generated candidate. Verify on site before any enforcement action.</div>

      <div className="detail-actions">
        <button className="btn-sm-action btn-confirm big" onClick={onConfirm}>
          <IconCheck width={14} height={14} /> Confirm kiln
        </button>
        <button className="btn-sm-action btn-reject big" onClick={onReject}>
          <IconClose width={14} height={14} /> False alarm
        </button>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-cell">
      <div className="stat-cell-val">{value}</div>
      <div className="stat-cell-lbl">{label}</div>
    </div>
  );
}
