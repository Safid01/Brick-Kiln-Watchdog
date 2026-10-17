"use client";

import type { Alert } from "@/lib/types";
import { bufferPct, evidenceUrl, fmtDistance, techClass } from "@/lib/ui";

interface Props {
  alert: Alert;
  selected: boolean;
  onSelect: () => void;
  onConfirm: () => void;
  onReject: () => void;
}

export default function AlertCard({ alert: a, selected, onSelect, onConfirm, onReject }: Props) {
  const tier = a.audit_metrics.priority_tier;
  const tech = techClass(a);
  const img = evidenceUrl(a);
  const verdict = a.human_verification?.status;

  return (
    <div
      id={`card-${a.kiln_id}`}
      className={`card status-${tier}${selected ? " selected" : ""}`}
      onClick={onSelect}
    >
      <div className="card-top">
        <div className="card-id-group">
          <span className="card-id">{a.kiln_id}</span>
          <span className="region-pill">{a.region}</span>
        </div>
        <span className={`badge badge-${tier}`}>{tier}</span>
      </div>

      <div className="meta-tags-row">
        <span className={`tech-badge tech-${tech}`}>{a.technology.badge}</span>
        <span className="dim-tag">conf {(a.audit_metrics.confidence * 100).toFixed(0)}%</span>
        {verdict === "CONFIRMED_KILN" && <span className="verified-badge">✅ Confirmed</span>}
      </div>

      <div className="card-content">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {img && <img className="card-thumb" src={img} alt={`Evidence crop for ${a.kiln_id}`} loading="lazy" />}
        <div className="card-details">
          <div className="receptor-line" title={a.audit_metrics.nearest_receptor}>
            🏫 {a.audit_metrics.nearest_receptor}
            <span className="muted"> · {a.audit_metrics.receptor_type}</span>
          </div>
          <div className="distance-line">
            <span className="muted">Distance</span>
            <span className={`distance-val ${tier === "COMPLIANT" ? "safe" : "breach"}`}>
              {fmtDistance(a.audit_metrics.distance_to_receptor_m)}
            </span>
          </div>
          <div className="buffer-progress" title="Share of the 1,000 m buffer">
            <div className="buffer-bar" style={{ width: `${bufferPct(a.audit_metrics.distance_to_receptor_m)}%` }} />
          </div>
        </div>
      </div>

      <div className="card-actions-bar" onClick={(e) => e.stopPropagation()}>
        <div className="btn-verify-group">
          <button className="btn-sm-action btn-confirm" onClick={onConfirm}>
            ✅ Confirm
          </button>
          <button className="btn-sm-action btn-reject" onClick={onReject}>
            ❌ False alarm
          </button>
        </div>
        <button className="btn-trace" onClick={onSelect}>
          📍 Trace
        </button>
      </div>
    </div>
  );
}
