"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Alert, ReceptorCollection } from "@/lib/types";
import { TIER_COLOR, techClass } from "@/lib/ui";

export type Basemap = "satellite" | "street";

const BASEMAPS: Record<Basemap, { url: string; attr: string; maxZoom: number; maxNativeZoom: number }> = {
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attr: "",
    maxZoom: 22,
    maxNativeZoom: 18,
  },
  street: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attr: "",
    maxZoom: 22,
    maxNativeZoom: 19,
  },
};

import { DISTRICT_BOXES, DHAKA_DIVISION_MACRO_BOUNDS } from "@/lib/districts";

interface Props {
  alerts: Alert[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  basemap: Basemap;
  showBuffers: boolean;
  showReceptors: boolean;
  showDistricts?: boolean;
  onSelectDistrict?: (dist: string) => void;
  receptors: ReceptorCollection | null;
  isAddingKiln?: boolean;
  onMapClickCoord?: (lat: number, lon: number) => void;
  pendingCoord?: { lat: number; lon: number } | null;
}

/** Leaflet treats tooltip strings as HTML; OSM names are untrusted, so use text nodes. */
function textEl(text: string): HTMLElement {
  const d = document.createElement("div");
  d.textContent = text;
  return d;
}

interface Groups {
  receptors: L.LayerGroup;
  buffers: L.LayerGroup;
  kilns: L.LayerGroup;
  vector: L.LayerGroup;
  districts: L.LayerGroup;
  pending: L.LayerGroup;
}

export default function MapView({
  alerts,
  selectedId,
  onSelect,
  basemap,
  showBuffers,
  showReceptors,
  showDistricts = true,
  onSelectDistrict,
  receptors,
  isAddingKiln = false,
  onMapClickCoord,
  pendingCoord = null,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const groups = useRef<Groups | null>(null);
  const alertsRef = useRef(alerts);
  const onSelectRef = useRef(onSelect);
  const isAddingKilnRef = useRef(isAddingKiln);
  const onMapClickCoordRef = useRef(onMapClickCoord);
  const fitted = useRef(false);

  useEffect(() => {
    alertsRef.current = alerts;
    onSelectRef.current = onSelect;
    isAddingKilnRef.current = isAddingKiln;
    onMapClickCoordRef.current = onMapClickCoord;
  });

  useEffect(() => {
    if (!el.current) return;
    if (isAddingKiln) {
      el.current.classList.add("map-crosshair");
    } else {
      el.current.classList.remove("map-crosshair");
    }
  }, [isAddingKiln]);

  // --- map lifecycle -------------------------------------------------------
  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const container = el.current;
    const map = L.map(container, {
      center: [23.85, 90.25],
      zoom: 9,
      maxZoom: 22,
      attributionControl: false,
      preferCanvas: true,
      zoomControl: false,
    });
    L.control.zoom({ position: "topleft" }).addTo(map);

    // Custom panes for strict z-index layering: kilns stay on top of all polygons
    map.createPane("districtsPane");
    map.getPane("districtsPane")!.style.zIndex = "250";

    map.createPane("kilnsPane");
    map.getPane("kilnsPane")!.style.zIndex = "550";

    groups.current = {
      districts: L.layerGroup().addTo(map),
      receptors: L.layerGroup().addTo(map),
      buffers: L.layerGroup().addTo(map),
      kilns: L.layerGroup().addTo(map),
      vector: L.layerGroup().addTo(map),
      pending: L.layerGroup().addTo(map),
    };

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (isAddingKilnRef.current && onMapClickCoordRef.current) {
        onMapClickCoordRef.current(e.latlng.lat, e.latlng.lng);
      } else {
        onSelectRef.current(null);
      }
    });

    const handleCaptureClick = (e: MouseEvent) => {
      if (!isAddingKilnRef.current || !onMapClickCoordRef.current || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".leaflet-control, .add-kiln-floating-bar, .add-kiln-modal-overlay")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const latlng = map.mouseEventToLatLng(e);
      if (latlng) {
        onMapClickCoordRef.current(latlng.lat, latlng.lng);
      }
    };

    container.addEventListener("click", handleCaptureClick, true);
    mapRef.current = map;

    return () => {
      container.removeEventListener("click", handleCaptureClick, true);
      map.remove();
      mapRef.current = null;
      groups.current = null;
      tileRef.current = null;
      fitted.current = false;
    };
  }, []);

  // --- basemap -------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRef.current?.remove();
    const b = BASEMAPS[basemap];
    tileRef.current = L.tileLayer(b.url, {
      attribution: "",
      maxZoom: b.maxZoom,
      maxNativeZoom: b.maxNativeZoom,
    }).addTo(map);
  }, [basemap]);

  // --- 13 District Bounding Boxes Layer ------------------------------------
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.districts.clearLayers();
    if (!showDistricts) return;

    // 1. Division Macro Boundary Box
    L.rectangle(DHAKA_DIVISION_MACRO_BOUNDS, {
      color: "#06b6d4",
      weight: 2,
      dashArray: "8 8",
      fillOpacity: 0.01,
      interactive: false,
      pane: "districtsPane",
    }).addTo(g.districts);

    // 2. Individual District Bounding Boxes (Visual only, non-blocking)
    for (const [, d] of Object.entries(DISTRICT_BOXES)) {
      L.rectangle(d.bounds, {
        color: d.color,
        weight: 1.5,
        opacity: 0.7,
        dashArray: "5 5",
        fillColor: d.color,
        fillOpacity: 0.03,
        className: "district-rect",
        interactive: false,
        pane: "districtsPane",
      }).addTo(g.districts);
    }
  }, [showDistricts]);

  // --- kiln markers (ALL kilns, including compliant/safe ones) --------------------
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.kilns.clearLayers();
    for (const a of alerts) {
      const ll: L.LatLngTuple = [a.coordinates.latitude, a.coordinates.longitude];
      const tier = a.audit_metrics.priority_tier;
      const selected = a.kiln_id === selectedId;
      L.circleMarker(ll, {
        pane: "kilnsPane",
        radius: selected ? 11 : 8,
        weight: selected ? 3.5 : techClass(a) === "FCBTK" ? 2.5 : 1.5,
        color: selected ? "#ffffff" : techClass(a) === "FCBTK" ? "#a855f7" : "#0b1220",
        fillColor: TIER_COLOR[tier],
        fillOpacity: 0.95,
        className: "interactive-kiln-marker",
      })
        .bindTooltip(textEl(`${a.kiln_id} · ${a.technology.badge} (${a.region})`), { direction: "top" })
        .on("click", (e: L.LeafletMouseEvent) => {
          if (isAddingKilnRef.current) {
            onMapClickCoordRef.current?.(e.latlng.lat, e.latlng.lng);
            return;
          }
          L.DomEvent.stopPropagation(e);
          onSelectRef.current(a.kiln_id);
        })
        .addTo(g.kilns);
    }
  }, [alerts, selectedId]);

  // --- fit to data once ------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitted.current || alerts.length === 0) return;
    const b = L.latLngBounds(alerts.map((a) => [a.coordinates.latitude, a.coordinates.longitude]));
    map.fitBounds(b, { padding: [50, 50] });
    fitted.current = true;
  }, [alerts]);

  // --- 1 km buffer rings -----------------------------------------------------
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.buffers.clearLayers();
    if (!showBuffers) return;
    for (const a of alerts) {
      const tier = a.audit_metrics.priority_tier;
      L.circle([a.coordinates.latitude, a.coordinates.longitude], {
        radius: 1000,
        color: TIER_COLOR[tier],
        weight: 1,
        opacity: 0.55,
        fillColor: TIER_COLOR[tier],
        fillOpacity: tier === "COMPLIANT" ? 0.02 : 0.07,
        dashArray: "4 5",
        interactive: false,
      }).addTo(g.buffers);
    }
  }, [alerts, showBuffers]);

  // --- protected receptors (lazy: only when toggled on) ----------------------
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.receptors.clearLayers();
    if (!showReceptors || !receptors) return;
    for (const f of receptors.features) {
      const [lon, lat] = f.geometry.coordinates;
      const medical = /hospital|clinic/.test(f.properties.type);
      L.circleMarker([lat, lon], {
        radius: 4,
        weight: 1,
        color: "#ffffff",
        fillColor: medical ? "#e11d48" : "#0284c7",
        fillOpacity: 0.9,
      })
        .bindTooltip(textEl(`${f.properties.name} (${f.properties.type})`))
        .on("click", (e: L.LeafletMouseEvent) => {
          if (isAddingKilnRef.current) {
            onMapClickCoordRef.current?.(e.latlng.lat, e.latlng.lng);
          }
        })
        .addTo(g.receptors);
    }
  }, [receptors, showReceptors]);

  // --- selected kiln: vector to nearest receptor + distance tag ---------------
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.vector.clearLayers();
    const a = alertsRef.current.find((x) => x.kiln_id === selectedId);
    if (!a) return;
    const k: L.LatLngTuple = [a.coordinates.latitude, a.coordinates.longitude];
    const tier = a.audit_metrics.priority_tier;
    const color = TIER_COLOR[tier];
    L.circle(k, { radius: 1000, color, weight: 2, fillOpacity: 0.05, dashArray: "6 6", interactive: false }).addTo(g.vector);

    const rc = a.audit_metrics.nearest_receptor_coords;
    if (rc?.latitude == null || rc.longitude == null) return;
    const r: L.LatLngTuple = [rc.latitude, rc.longitude];
    L.polyline([k, r], { color, weight: 3, dashArray: "6 6", interactive: false }).addTo(g.vector);
    L.circleMarker(r, { radius: 9, weight: 3, color: "#fef08a", fillColor: "#0284c7", fillOpacity: 1 })
      .bindTooltip(textEl(`${a.audit_metrics.nearest_receptor} (${a.audit_metrics.receptor_type})`))
      .addTo(g.vector);

    const tag = document.createElement("div");
    tag.className = `vector-tag ${tier.toLowerCase()}`;
    tag.textContent = `${Math.round(a.audit_metrics.distance_to_receptor_m)} m`;
    L.marker([(k[0] + r[0]) / 2, (k[1] + r[1]) / 2], {
      icon: L.divIcon({ html: tag, className: "", iconSize: [0, 0] }),
      interactive: false,
    }).addTo(g.vector);
  }, [selectedId, alerts]);

  // --- fly to selection (only when the selection changes, not on every poll) --
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const a = alertsRef.current.find((x) => x.kiln_id === selectedId);
    if (!a) return;
    const k: L.LatLngTuple = [a.coordinates.latitude, a.coordinates.longitude];
    const rc = a.audit_metrics.nearest_receptor_coords;
    if (rc?.latitude != null && rc.longitude != null && a.audit_metrics.distance_to_receptor_m < 3000) {
      map.flyToBounds(L.latLngBounds([k, [rc.latitude, rc.longitude]]).pad(0.5), {
        maxZoom: 16,
        duration: 0.8,
      });
    } else {
      map.flyTo(k, 15, { duration: 0.8 });
    }
  }, [selectedId]);

  // --- pending marker when placing new kiln ----------------------------------
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.pending.clearLayers();
    if (!pendingCoord) return;
    const ll: L.LatLngTuple = [pendingCoord.lat, pendingCoord.lon];

    L.circleMarker(ll, {
      radius: 12,
      weight: 3,
      color: "#ffffff",
      fillColor: "#06b6d4",
      fillOpacity: 0.95,
      className: "pending-kiln-marker",
    })
      .bindTooltip(textEl("📍 New Kiln Placement Target"), {
        direction: "top",
        permanent: true,
      })
      .addTo(g.pending);

    L.circle(ll, {
      radius: 1000,
      color: "#06b6d4",
      weight: 2,
      opacity: 0.8,
      dashArray: "6 6",
      fillColor: "#06b6d4",
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(g.pending);
  }, [pendingCoord]);

  return <div ref={el} className="map" />;
}

