"use client";

import { useState } from "react";
import type { Alert } from "@/lib/types";
import { bufferPct, evidenceUrl, fmtDistance, techClass } from "@/lib/ui";
import { IconCheck, IconClose, IconPin } from "./icons";

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
  const [imgBroken, setImgBroken] = useState(false);

  return (
    <div
      id={`card-${a.kiln_id}`}
      className={`card status-${tier}${selected ? " selected" : ""}`}
      onClick={onSelect}
    >
      <div className="card-top">
        <div className="card-id-group">
          <span className="card-id">{a.kiln_id}</span>
          <span className="region-pill" title={`Location: ${a.region}`}>
            <IconPin width={12} height={12} />
            {a.region}
          </span>
        </div>
        <span className={`badge badge-${tier}`}>{tier}</span>
      </div>

      <div className="card-content">
        {img && !imgBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="card-thumb"
            src={img}
            alt={`Evidence crop for ${a.kiln_id}`}
            loading="lazy"
            onError={() => setImgBroken(true)}
          />
        ) : (
          <div className="card-thumb thumb-missing">No image</div>
        )}
        <div className="card-details">
          <div className="distance-line">
            <span className="muted">Distance</span>
            <span className={`distance-val ${tier === "COMPLIANT" ? "safe" : "breach"}`}>
              {fmtDistance(a.audit_metrics.distance_to_receptor_m)}
            </span>
          </div>
          <div className="buffer-progress" title={`Buffer: ${bufferPct(a.audit_metrics.distance_to_receptor_m)}% of 1,000 m`}>
            <div className="buffer-bar" style={{ width: `${bufferPct(a.audit_metrics.distance_to_receptor_m)}%` }} />
          </div>
          <div className="meta-tags-row">
            <span className={`tech-badge tech-${tech}`}>{a.technology.badge}</span>
            <span className="dim-tag">conf {(a.audit_metrics.confidence * 100).toFixed(0)}%</span>
            {verdict === "CONFIRMED_KILN" && (
              <span className="verified-badge">
                <IconCheck width={11} height={11} /> Confirmed
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="card-actions-bar" onClick={(e) => e.stopPropagation()}>
        <div className="btn-verify-group">
          <button className="btn-sm-action btn-confirm" onClick={onConfirm}>
            <IconCheck width={13} height={13} /> Confirm
          </button>
          <button className="btn-sm-action btn-reject" onClick={onReject}>
            <IconClose width={13} height={13} /> False alarm
          </button>
        </div>
        <button className="btn-trace" onClick={onSelect}>
          <IconPin width={13} height={13} /> Trace
        </button>
      </div>
    </div>
  );
}
