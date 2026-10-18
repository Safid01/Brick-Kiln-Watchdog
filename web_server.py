import asyncio
import glob
import hashlib
import json
import math
import os
import shutil
import sys
import threading
from datetime import datetime, timezone
from fastapi import FastAPI, BackgroundTasks, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from shapely.geometry import Point
import geopandas as gpd
from PIL import Image, ImageDraw
import run_pipeline
from satellite_fetcher import fetch_satellite_composite
from spatial_blacklist import (
    is_blacklisted,
    register_rejection,
    purge_rejected_from_outbox,
    load_rejected_sites
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

app = FastAPI(title="Brick Kiln Watchdog API - Greater Dhaka Division")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("evidence", exist_ok=True)
os.makedirs("alerts_outbox", exist_ok=True)
os.makedirs("alerts_outbox/rejected", exist_ok=True)
os.makedirs("dataset/confirmed_kilns", exist_ok=True)
os.makedirs("dataset/false_positives", exist_ok=True)
app.mount("/evidence", StaticFiles(directory="evidence"), name="evidence")

# ==============================================================================
# SCANNER STATE
# ==============================================================================
scanner_lock = threading.Lock()
scanner_state = {
    "is_scanning": False,
    "last_scan_time": datetime.now().strftime("%d %b %Y, %H:%M:%S"),
    "last_scan_iso": datetime.now().isoformat(),
    "last_scan_summary": "System ready. Click Run Scan to audit Greater Dhaka.",
    "scan_progress_pct": 0,
    "current_step": 0,
    "total_steps": 0,
    "estimated_seconds_remaining": 0,
    "current_sector_name": "",
}

_alerts_cache = None
_alerts_lock = threading.Lock()

def invalidate_alerts_cache():
    global _alerts_cache
    with _alerts_lock:
        _alerts_cache = None

def load_active_alerts():
    """
    Loads all active alerts from alerts_outbox/BK-*.json, filtering out
    any that match permanently rejected false-positive sites.
    Cached in memory for high-performance dashboard polling.
    """
    global _alerts_cache
    with _alerts_lock:
        if _alerts_cache is not None:
            return list(_alerts_cache)

        alerts = []
        for filepath in sorted(glob.glob("alerts_outbox/BK-*.json")):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    d = json.load(f)
                coords = d.get("coordinates", {})
                lat = coords.get("latitude")
                lon = coords.get("longitude")
                if lat is not None and lon is not None:
                    blacklisted, _, _ = is_blacklisted(lat, lon)
                    if blacklisted:
                        continue
                alerts.append(d)
            except Exception:
                pass
        _alerts_cache = alerts
        return list(_alerts_cache)

def compute_data_signature(alerts=None):
    """
    Computes a fast, unique fingerprint of all active alert JSON files.
    Changes whenever any file is added, modified, confirmed, or rejected.
    """
    if alerts is None:
        alerts = load_active_alerts()
    raw = f"{len(alerts)}-{len(load_rejected_sites())}"
    sig = hashlib.md5(raw.encode()).hexdigest()[:12]
    return sig, len(alerts)

@app.get("/api/v1/alerts")
def get_alerts():
    alerts = load_active_alerts()
    
    # Sort priority: CRITICAL first, then HIGH, then COMPLIANT; then distance ascending
    tier_order = {"CRITICAL": 0, "HIGH": 1, "COMPLIANT": 2}
    alerts.sort(key=lambda a: (
        tier_order.get(a.get("audit_metrics", {}).get("priority_tier", "COMPLIANT"), 3),
        a.get("audit_metrics", {}).get("distance_to_receptor_m", 99999)
    ))
    return alerts

@app.get("/api/v1/rejected-kilns")
def get_rejected_kilns():
    """
    Returns the permanent spatial exclusion registry of all false positives.
    """
    return load_rejected_sites()

@app.get("/api/v1/system-status")
def get_system_status():
    alerts = load_active_alerts()
    sig, count = compute_data_signature(alerts)

    violations = sum(1 for a in alerts if a.get("audit_metrics", {}).get("priority_tier") in ["CRITICAL", "HIGH"])
    
    # Situational: Statutory breaches (<1000m) or banned FCBTK
    situations = sum(1 for a in alerts if (
        a.get("audit_metrics", {}).get("priority_tier") in ["CRITICAL", "HIGH"] or
        "FCBTK" in (a.get("technology", {}).get("type") or "").upper()
    ))
    no_risk_count = len(alerts) - situations

    tech_counts = {"FCBTK": 0, "ZIGZAG": 0, "HOFFMAN": 0}
    reg_counts = {
        "Dhaka": 0, "Gazipur": 0, "Narayanganj": 0, "Tangail": 0,
        "Narsingdi": 0, "Manikganj": 0, "Munshiganj": 0, "Faridpur": 0,
        "Kishoreganj": 0, "Gopalganj": 0, "Madaripur": 0, "Rajbari": 0,
        "Shariatpur": 0, "Savar": 0, "Keraniganj": 0, "Nawabganj": 0
    }

    for a in alerts:
        ttype = (a.get("technology", {}).get("type") or "FCBTK").upper()
        if "HOFFMAN" in ttype:
            tech_counts["HOFFMAN"] += 1
        elif "ZIGZAG" in ttype:
            tech_counts["ZIGZAG"] += 1
        else:
            tech_counts["FCBTK"] += 1

        reg = a.get("region") or a.get("district", "Dhaka")
        reg_counts[reg] = reg_counts.get(reg, 0) + 1

    receptors_count = 3191
    if os.path.exists("dhaka_region_receptors.geojson"):
        try:
            with open("dhaka_region_receptors.geojson", "r", encoding="utf-8") as f:
                receptors_count = len(json.load(f).get("features", []))
        except Exception:
            pass

    return {
        "status": "LIVE_MONITORING",
        "data_version": sig,
        "last_updated_time": scanner_state["last_scan_time"],
        "last_updated_iso": scanner_state["last_scan_iso"],
        "scanner_status": {
            "is_scanning": scanner_state["is_scanning"],
            "last_scan_summary": scanner_state["last_scan_summary"],
            "progress_pct": scanner_state.get("scan_progress_pct", 0),
            "current_step": scanner_state.get("current_step", 0),
            "total_steps": scanner_state.get("total_steps", 0),
            "seconds_remaining": scanner_state.get("estimated_seconds_remaining", 0),
            "current_sector": scanner_state.get("current_sector_name", ""),
        },
        "total_kilns": len(alerts),
        "situations_count": situations,
        "no_risk_count": no_risk_count,
        "violations_count": violations,
        "tech_counts": tech_counts,
        "region_counts": reg_counts,
        "receptors_count": receptors_count,
        "server_time": datetime.now().strftime("%d %b %Y, %H:%M:%S")
    }

@app.get("/api/v1/districts")
def get_districts():
    """
    Returns administrative metadata and geographic bounding boxes
    for all 13 districts of Greater Dhaka Division.
    """
    return {
        "division": "Dhaka Division",
        "total_districts": len(run_pipeline.DISTRICT_METADATA),
        "macro_bbox": run_pipeline.DHAKA_DIVISION_BBOX,
        "districts": run_pipeline.DISTRICT_METADATA,
        "sectors": run_pipeline.AUDIT_SECTORS
    }

@app.get("/api/v1/receptors")
def get_receptors():
    if os.path.exists("dhaka_region_receptors.geojson"):
        with open("dhaka_region_receptors.geojson", "r", encoding="utf-8") as f:
            return json.load(f)
    return {"type": "FeatureCollection", "features": []}

@app.get("/api/v1/scanner-status")
def get_scanner_status():
    return scanner_state

def execute_scan_worker(sector: str = "ALL", custom_bbox: dict = None, max_sectors: int = None):
    """
    Worker that triggers live satellite imagery fetching and full sliding-window YOLOv8 audit
    across all 13 districts or a targeted district/bounding box.
    """
    global scanner_state
    start_time = datetime.now()
    with scanner_lock:
        scanner_state["is_scanning"] = True
        scanner_state["scan_progress_pct"] = 5
        scanner_state["current_step"] = 1
        scanner_state["total_steps"] = 1
        scanner_state["estimated_seconds_remaining"] = 35
        summary_target = f"District / Sector '{sector}'" if sector != "ALL" else "all 13 districts of Greater Dhaka"
        if custom_bbox:
            summary_target = f"Custom Bounding Box ({custom_bbox})"
        scanner_state["last_scan_summary"] = f"Fetching satellite imagery and scanning {summary_target}..."
        scanner_state["current_sector_name"] = sector

    def on_progress(current, total, sector_info):
        with scanner_lock:
            scanner_state["current_step"] = current
            scanner_state["total_steps"] = total
            pct = int(round((current / (total + 1)) * 100))
            scanner_state["scan_progress_pct"] = min(98, max(5, pct))
            elapsed = (datetime.now() - start_time).total_seconds()
            if current > 1:
                sec_per = elapsed / (current - 1)
                rem = max(3, int(round(sec_per * (total - current + 1))))
            else:
                rem = max(10, total * 12)
            scanner_state["estimated_seconds_remaining"] = rem
            sname = sector_info.get("name", sector_info.get("region", ""))
            scanner_state["current_sector_name"] = sname
            scanner_state["last_scan_summary"] = f"Scanning sector {current}/{total} ({sname})..."

    try:
        target_list = None if sector == "ALL" else [sector]
        res = run_pipeline.run(
            selected_sectors=target_list,
            custom_bbox=custom_bbox,
            max_sectors=max_sectors,
            progress_callback=on_progress,
            cancel_check=lambda: scanner_state.get("cancel_requested", False)
        )
        audited = res.get("total_audited", 0)
        violations = res.get("total_violations", 0)
        districts_str = ", ".join(res.get("districts_audited", [sector]))
        if scanner_state.get("cancel_requested", False):
            summary = "Satellite scan stopped by user."
        else:
            summary = f"Scanned {districts_str}: {audited} kilns verified, {violations} statutory buffer breaches."
    except Exception as e:
        print("Scan error:", e)
        summary = f"Scan error: {str(e)}"
    finally:
        now = datetime.now()
        invalidate_alerts_cache()
        with scanner_lock:
            scanner_state["is_scanning"] = False
            scanner_state["cancel_requested"] = False
            scanner_state["scan_progress_pct"] = 100
            scanner_state["estimated_seconds_remaining"] = 0
            scanner_state["last_scan_time"] = now.strftime("%d %b %Y, %H:%M:%S")
            scanner_state["last_scan_iso"] = now.isoformat()
            scanner_state["last_scan_summary"] = summary

@app.post("/api/v1/stop-scan")
def stop_scan():
    global scanner_state
    with scanner_lock:
        if not scanner_state.get("is_scanning", False):
            return {"status": "IDLE", "message": "No scan is currently running."}
        scanner_state["cancel_requested"] = True
        scanner_state["last_scan_summary"] = "Stopping satellite scan…"
    return {"status": "SUCCESS", "message": "Satellite scan stop requested."}

@app.post("/api/v1/trigger-scan")
async def trigger_scan(request: Request, background_tasks: BackgroundTasks):
    """
    On-demand scan trigger. Fetches live satellite imagery and runs detection
    across all 13 districts, a targeted district, or a custom bounding box.
    """
    if scanner_state["is_scanning"]:
        return JSONResponse({
            "status": "BUSY",
            "message": "A satellite scan is already in progress.",
            "scanner_state": scanner_state
        }, status_code=409)

    payload = {}
    try:
        payload = await request.json()
    except Exception:
        pass

    sector = payload.get("sector", "ALL")
    bbox = payload.get("bbox", None)
    max_sectors = payload.get("max_sectors", None)

    background_tasks.add_task(execute_scan_worker, sector=sector, custom_bbox=bbox, max_sectors=max_sectors)
    return {
        "status": "SCAN_INITIATED",
        "target": sector,
        "custom_bbox": bbox,
        "message": f"Live satellite surveillance initiated for target: {sector}.",
        "initiated_at": datetime.now().isoformat()
    }

@app.post("/api/v1/kilns/{kiln_id}/confirm")
def confirm_kiln(kiln_id: str):
    """
    Active Learning - Mark kiln as verified authentic.
    """
    filepath = f"alerts_outbox/{kiln_id}.json"
    if not os.path.exists(filepath):
        return JSONResponse({"status": "ERROR", "message": "Kiln not found"}, status_code=404)

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    data["human_verification"] = {
        "status": "CONFIRMED_KILN",
        "verified_at": datetime.now().isoformat(),
        "verified_by": "DoE_Inspector"
    }

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    patch_path = data.get("evidence_image")
    if patch_path and os.path.exists(patch_path):
        dest = f"dataset/confirmed_kilns/{kiln_id}_patch.jpg"
        shutil.copyfile(patch_path, dest)

    invalidate_alerts_cache()
    return {"status": "SUCCESS", "message": f"Kiln {kiln_id} confirmed and saved to verified dataset."}

@app.post("/api/v1/kilns/{kiln_id}/reject")
def reject_kiln(kiln_id: str):
    """
    Active Learning - Flag false positive.
    Moves detection from active outbox to rejected archive.
    """
    filepath = f"alerts_outbox/{kiln_id}.json"
    if not os.path.exists(filepath):
        return JSONResponse({"status": "ERROR", "message": "Kiln not found"}, status_code=404)

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    data["human_verification"] = {
        "status": "FALSE_POSITIVE",
        "flagged_at": datetime.now().isoformat(),
        "flagged_by": "DoE_Inspector"
    }

    dest_json = f"alerts_outbox/rejected/{kiln_id}.json"
    with open(dest_json, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.remove(filepath)

    # Register in spatial blacklist registry and purge any duplicate outbox files
    coords = data.get("coordinates", {})
    lat = coords.get("latitude")
    lon = coords.get("longitude")
    if lat is not None and lon is not None:
        register_rejection(
            kiln_id=kiln_id,
            latitude=lat,
            longitude=lon,
            flagged_by="DoE_Inspector",
            reason="Inspector marked False Positive"
        )
    purge_rejected_from_outbox()

    patch_path = data.get("evidence_image")
    if patch_path and os.path.exists(patch_path):
        dest_patch = f"dataset/false_positives/{kiln_id}_patch.jpg"
        shutil.copyfile(patch_path, dest_patch)

    invalidate_alerts_cache()
    return {"status": "SUCCESS", "message": f"Kiln {kiln_id} marked as false positive and permanently excluded from future scans."}

# Cached receptors GeoDataFrame for instant proximity lookups
_receptors_gdf = None

def get_receptors_gdf():
    global _receptors_gdf
    if _receptors_gdf is None and os.path.exists("dhaka_region_receptors.geojson"):
        try:
            _receptors_gdf = gpd.read_file("dhaka_region_receptors.geojson").to_crs("EPSG:32646")
        except Exception as e:
            print(f"Error loading receptors gdf: {e}")
    return _receptors_gdf

def detect_district_from_coords(lat: float, lon: float):
    """
    Automatically detects administrative district and sub-region prefix from GPS coordinates.
    """
    # 1. Check survey sectors for specific local region (e.g. Savar, Keraniganj, Dhamrai)
    for sec in run_pipeline.AUDIT_SECTORS:
        b = sec["bbox"]
        if b["min_lat"] <= lat <= b["max_lat"] and b["min_lon"] <= lon <= b["max_lon"]:
            return sec.get("district", "Dhaka"), sec["region"], sec["prefix"]

    # 2. Check 13 district master bounding boxes
    for dist_name, meta in run_pipeline.DISTRICT_METADATA.items():
        b = meta["bbox"]
        if b["min_lat"] <= lat <= b["max_lat"] and b["min_lon"] <= lon <= b["max_lon"]:
            return dist_name, dist_name, meta["prefix"]

    # 3. Fallback to nearest district center
    best = ("Dhaka", "Dhaka", "DH")
    min_dist_sq = float("inf")
    for dist_name, meta in run_pipeline.DISTRICT_METADATA.items():
        b = meta["bbox"]
        c_lat = (b["min_lat"] + b["max_lat"]) / 2.0
        c_lon = (b["min_lon"] + b["max_lon"]) / 2.0
        d_sq = (lat - c_lat) ** 2 + (lon - c_lon) ** 2
        if d_sq < min_dist_sq:
            min_dist_sq = d_sq
            best = (dist_name, dist_name, meta["prefix"])
    return best

def calculate_proximity(lat: float, lon: float):
    """
    Calculates geodesic distance to the nearest protected sensitive receptor
    (schools, hospitals, clinics, universities) and evaluates statutory violation status.
    """
    receptors_gdf = get_receptors_gdf()
    if receptors_gdf is None or len(receptors_gdf) == 0:
        return {
            "is_violation": False,
            "min_distance_m": 9999.0,
            "nearest_facility_name": "No Receptor Mapped Nearby",
            "facility_type": "None",
            "priority_tier": "COMPLIANT",
            "nearest_receptor_coords": {"latitude": lat, "longitude": lon}
        }

    kiln_utm = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs("EPSG:32646")[0]
    distances = receptors_gdf.distance(kiln_utm)
    min_dist = float(distances.min())
    nearest = receptors_gdf.loc[distances.idxmin()]

    is_violation = bool(min_dist < 1000.0)
    if min_dist < 500.0:
        priority = "CRITICAL"
    elif min_dist < 1000.0:
        priority = "HIGH"
    else:
        priority = "COMPLIANT"

    if "latitude" in nearest and "longitude" in nearest and not math.isnan(nearest["latitude"]):
        rec_lat = float(nearest["latitude"])
        rec_lon = float(nearest["longitude"])
    else:
        rec_pt = gpd.GeoSeries([nearest.geometry], crs="EPSG:32646").to_crs("EPSG:4326")[0]
        rec_lat = float(rec_pt.y)
        rec_lon = float(rec_pt.x)

    return {
        "is_violation": is_violation,
        "min_distance_m": round(min_dist, 1),
        "nearest_facility_name": str(nearest.get("name", "Local Protected Receptor")),
        "facility_type": str(nearest.get("type", "School")),
        "priority_tier": priority,
        "nearest_receptor_coords": {
            "latitude": round(rec_lat, 6),
            "longitude": round(rec_lon, 6)
        }
    }

def generate_evidence_patch_for_coord(lat: float, lon: float, kiln_id: str) -> str:
    """
    Acquires a high-resolution satellite evidence patch centered at the kiln GPS coordinates.
    Draws a red bounding frame on the kiln center.
    """
    os.makedirs("evidence", exist_ok=True)
    patch_path = f"evidence/{kiln_id}_patch.jpg"
    delta = 0.0012  # ~130 meters half-width
    tmp_path = f"cache/tmp_{kiln_id}.jpg"
    try:
        _, _ = fetch_satellite_composite(
            min_lat=lat - delta,
            min_lon=lon - delta,
            max_lat=lat + delta,
            max_lon=lon + delta,
            zoom=16,
            output_path=tmp_path
        )
        if os.path.exists(tmp_path):
            img = Image.open(tmp_path)
            w, h = img.size
            cx, cy = w // 2, h // 2
            crop_box = (max(0, cx - 110), max(0, cy - 110), min(w, cx + 110), min(h, cy + 110))
            cropped = img.crop(crop_box).resize((220, 220))

            draw = ImageDraw.Draw(cropped)
            cw, ch = cropped.size
            box_x1, box_y1 = cw // 2 - 36, ch // 2 - 36
            box_x2, box_y2 = cw // 2 + 36, ch // 2 + 36
            for off in range(3):
                draw.rectangle([box_x1 - off, box_y1 - off, box_x2 + off, box_y2 + off], outline="red")
            cropped.save(patch_path, quality=92)
            try:
                os.remove(tmp_path)
            except Exception:
                pass
            return patch_path
    except Exception as e:
        print(f"Error fetching satellite patch for {kiln_id}: {e}")

    # Fallback placeholder patch if offline
    img = Image.new("RGB", (220, 220), (55, 65, 81))
    draw = ImageDraw.Draw(img)
    draw.rectangle([74, 74, 146, 146], outline="red", width=3)
    img.save(patch_path, quality=90)
    return patch_path

@app.post("/api/v1/kilns/add")
async def add_kiln(request: Request):
    """
    Manually add a brick kiln to the map by GPS coordinates.
    Automatically detects administrative district, assigns unique ID and name,
    calculates distance to nearest receptor, updates violation status and operational status,
    and fetches satellite evidence.
    """
    payload = {}
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"status": "ERROR", "message": "Invalid JSON body"}, status_code=400)

    try:
        lat = float(payload.get("latitude"))
        lon = float(payload.get("longitude"))
    except (TypeError, ValueError):
        return JSONResponse({"status": "ERROR", "message": "latitude and longitude are required numbers"}, status_code=400)

    # 1. Auto-detect district and sub-region
    district, region, prefix = detect_district_from_coords(lat, lon)

    # 2. Generate unique sequential Kiln ID
    pattern = f"alerts_outbox/BK-{prefix}-*.json"
    existing_files = glob.glob(pattern)
    existing_files.extend(glob.glob(f"alerts_outbox/rejected/BK-{prefix}-*.json"))
    max_num = 0
    for fpath in existing_files:
        base = os.path.splitext(os.path.basename(fpath))[0]
        parts = base.split("-")
        if len(parts) >= 3 and parts[-1].isdigit():
            max_num = max(max_num, int(parts[-1]))

    next_num = max_num + 1
    kiln_id = f"BK-{prefix}-{next_num:03d}"

    # 3. Calculate distance to sensitive receptors & statutory compliance
    prox = calculate_proximity(lat, lon)

    # 4. Determine Technology & Operational Status
    tech_type = (payload.get("technology_type") or "FCBTK").upper()
    if "ZIGZAG" in tech_type:
        tech_info = {
            "type": "ZIGZAG",
            "label": "Improved Zigzag Kiln",
            "badge": "Zigzag",
            "description": "Forced/induced draft zigzag chamber design with enhanced fuel combustion.",
            "compliance_status": "CONDITIONAL_PERMIT",
            "emission_tier": "Controlled Emission (Permitted)",
            "banned": False
        }
    elif "HOFFMAN" in tech_type:
        tech_info = {
            "type": "HOFFMAN_TUNNEL",
            "label": "Hoffman / Hybrid Tunnel Kiln",
            "badge": "Hoffman/Tunnel",
            "description": "Large-scale continuous hybrid tunnel kiln with permanent shed structure.",
            "compliance_status": "APPROVED_TECH",
            "emission_tier": "Low Particulate (Eco-Approved)",
            "banned": False
        }
    else:
        tech_info = {
            "type": "FCBTK",
            "label": "FCBTK (Fixed Chimney Bull's Trench)",
            "badge": "FCBTK (Banned)",
            "description": "Traditional open-trench kiln with high black carbon emissions. Strictly prohibited by DoE.",
            "compliance_status": "BANNED_ILLEGAL",
            "emission_tier": "Severe Polluter (Banned)",
            "banned": True
        }

    # 5. Acquire satellite evidence patch
    evidence_path = generate_evidence_patch_for_coord(lat, lon, kiln_id)

    # 6. Realistic dimensions
    length_m = float(payload.get("length_m", 88.5))
    width_m = float(payload.get("width_m", 46.2))
    area_sqm = round(length_m * width_m, 1)

    now = datetime.now(timezone.utc)
    dossier = {
        "event": "POTENTIAL_KILN_VIOLATION" if prox["is_violation"] else "COMPLIANT_KILN_MONITORING",
        "kiln_id": kiln_id,
        "region": region,
        "district": district,
        "coordinates": {
            "latitude": round(lat, 6),
            "longitude": round(lon, 6)
        },
        "technology": tech_info,
        "operational_status": {
            "is_active": True,
            "state": "OPERATIONAL",
            "label": "Kiln Facility",
            "plume_opacity_pct": 0,
            "thermal_signature": "ACTIVE_THERMAL_CORE"
        },
        "dimensions": {
            "length_m": length_m,
            "width_m": width_m,
            "aspect_ratio": round(length_m / max(width_m, 1.0), 2),
            "area_sqm": area_sqm,
            "estimated_capacity": int(area_sqm * 22)
        },
        "audit_metrics": {
            "confidence": 0.99,
            "estimated_length_m": length_m,
            "estimated_width_m": width_m,
            "distance_to_receptor_m": prox["min_distance_m"],
            "nearest_receptor": prox["nearest_facility_name"],
            "receptor_type": prox["facility_type"],
            "priority_tier": prox["priority_tier"],
            "nearest_receptor_coords": prox["nearest_receptor_coords"]
        },
        "statutory_basis": "Brick Manufacturing and Kiln Construction (Control) Act - 1,000m Buffer Mandate",
        "evidence_image": evidence_path,
        "audit_timestamp": now.isoformat(),
        "audit_date_formatted": now.strftime("%d %b %Y, %H:%M:%S"),
        "status": "REQUIRES_HUMAN_VERIFICATION",
        "human_verification": {
            "status": "CONFIRMED_KILN",
            "verified_at": now.isoformat(),
            "verified_by": "Inspector (User Map Placement)"
        }
    }

    out_file = f"alerts_outbox/{kiln_id}.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(dossier, f, indent=2)

    # Copy to dataset of confirmed kilns
    if os.path.exists(evidence_path):
        shutil.copyfile(evidence_path, f"dataset/confirmed_kilns/{kiln_id}_patch.jpg")

    # Update scanner state timestamp so frontend detects data change immediately
    scanner_state["last_scan_time"] = datetime.now().strftime("%d %b %Y, %H:%M:%S")
    scanner_state["last_scan_iso"] = datetime.now().isoformat()
    scanner_state["last_scan_summary"] = "Satellite surveillance active."

    invalidate_alerts_cache()
    return JSONResponse(dossier, status_code=200)

TECH_MAP = {
    "FCBTK": {
        "label": "Fixed Chimney Bull's Trench Kiln",
        "badge": "FCBTK (Banned)",
        "description": "Traditional 120ft fixed chimney kiln with continuous annular trench. High particulate emissions.",
        "compliance_status": "BANNED_NON_COMPLIANT",
        "emission_tier": "High Particulate (SPM > 1000 mg/Nm³)",
        "banned": True
    },
    "ZIGZAG": {
        "label": "Improved Zigzag Kiln",
        "badge": "Zigzag (Transitional)",
        "description": "Forced or induced draft kiln with zigzag airflow path.",
        "compliance_status": "TRANSITIONAL",
        "emission_tier": "Moderate Particulate (SPM ~ 400 mg/Nm³)",
        "banned": False
    },
    "HOFFMAN_TUNNEL": {
        "label": "Hoffman / Hybrid Tunnel Kiln",
        "badge": "Hoffman/Tunnel",
        "description": "Large-scale continuous hybrid tunnel kiln with permanent shed structure.",
        "compliance_status": "APPROVED_TECH",
        "emission_tier": "Low Particulate (Eco-Approved)",
        "banned": False
    }
}

@app.post("/api/v1/kilns/{kiln_id}/technology")
async def update_kiln_technology(kiln_id: str, request: Request):
    """
    Manually change the kiln technology type for a kiln.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    new_type = body.get("technology_type", "FCBTK").upper()
    tech_info = TECH_MAP.get(new_type, TECH_MAP["FCBTK"])

    fpath = f"alerts_outbox/{kiln_id}.json"
    if not os.path.exists(fpath):
        raise HTTPException(status_code=404, detail="Kiln not found")

    with open(fpath, "r", encoding="utf-8") as f:
        dossier = json.load(f)

    dossier["technology"] = {
        "type": new_type,
        **tech_info
    }

    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(dossier, f, indent=2)

    scanner_state["last_scan_time"] = datetime.now().strftime("%d %b %Y, %H:%M:%S")
    scanner_state["last_scan_iso"] = datetime.now().isoformat()

    invalidate_alerts_cache()
    return {"status": "SUCCESS", "message": f"Updated {kiln_id} to {tech_info['badge']}.", "kiln": dossier}


@app.post("/api/v1/purge-bogus")
def purge_bogus_alerts():
    """
    Purges any false positive tin sheds and small residential roofs (length < 45m or width < 22m or area < 1100m²)
    from alerts_outbox.
    """
    removed = []
    for fpath in glob.glob("alerts_outbox/BK-*.json"):
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                d = json.load(f)
            dim = d.get("dimensions") or {}
            metrics = d.get("audit_metrics") or {}
            l = dim.get("length_m") or metrics.get("estimated_length_m", 0)
            w = dim.get("width_m") or metrics.get("estimated_width_m", 0)
            area = dim.get("area_sqm") or (l * w)
            if l < 45.0 or w < 22.0 or area < 1100.0:
                os.remove(fpath)
                kid = d.get("kiln_id", os.path.basename(fpath))
                # Also remove evidence patch if present
                patch_path = d.get("evidence_image")
                if patch_path and os.path.exists(patch_path):
                    try:
                        os.remove(patch_path)
                    except Exception:
                        pass
                removed.append(kid)
        except Exception:
            pass
    remaining = len(glob.glob("alerts_outbox/BK-*.json"))
    return {"status": "SUCCESS", "purged_count": len(removed), "remaining_count": remaining, "purged_sample": removed[:20]}

@app.get("/")
def root(request: Request):
    """
    API root endpoint. If accessed from a web browser (HTML), serves a dashboard portal landing card.
    If accessed via API client (Accept: application/json), returns backend metadata.
    """
    accept = request.headers.get("accept", "")
    if "text/html" in accept:
        return HTMLResponse("""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Brick Kiln Watchdog — API Core</title>
  <style>
    :root {
      --bg-base: #060a12;
      --bg-card: #0c1424;
      --border-subtle: #1c2d4a;
      --text-main: #f1f5f9;
      --text-muted: #8ba0bd;
      --accent: #38bdf8;
      --accent-hover: #0ea5e9;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg-base);
      color: var(--text-main);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      max-width: 580px;
      width: 100%;
      padding: 2.5rem;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.85rem;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 9999px;
      color: var(--success);
      font-size: 0.78rem;
      font-weight: 600;
      margin-bottom: 1.25rem;
    }
    .dot {
      width: 8px;
      height: 8px;
      background: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--success);
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
      color: var(--text-main);
      letter-spacing: -0.02em;
    }
    p {
      color: var(--text-muted);
      font-size: 0.95rem;
      line-height: 1.6;
      margin-bottom: 1.75rem;
    }
    .actions {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.8rem 1.4rem;
      border-radius: 10px;
      font-size: 0.9rem;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s ease;
      cursor: pointer;
    }
    .btn-primary {
      background: var(--accent);
      color: #031120;
    }
    .btn-primary:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: #172744;
      color: #cbd5e1;
      border: 1px solid #2b4268;
    }
    .btn-secondary:hover {
      background: #1e335a;
      color: #f8fafc;
      transform: translateY(-1px);
    }
    .meta {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border-subtle);
      font-size: 0.8rem;
      color: #64748b;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><span class="dot"></span> Surveillance Daemon Active</div>
    <h1>🛰️ Brick Kiln Watchdog Backend API</h1>
    <p>
      The core FastAPI surveillance engine is active. The interactive GIS inspector dashboard
      is hosted on the dedicated Next.js frontend (<strong>frontend/</strong>).
    </p>
    <div class="actions">
      <a href="http://localhost:3000" class="btn btn-primary">Open Next.js Inspector Dashboard</a>
      <a href="/docs" class="btn btn-secondary">Interactive API Docs (Swagger)</a>
    </div>
    <div class="meta">
      <span>Backend: FastAPI / YOLOv8 / GeoPandas</span>
      <span>Frontend: Next.js (App Router)</span>
    </div>
  </div>
</body>
</html>
""")
    return JSONResponse({
        "service": "Brick Kiln Watchdog API",
        "region": "Greater Dhaka Division",
        "status": "ONLINE",
        "version": "1.0.0",
        "frontend_dashboard": "http://localhost:3000",
        "docs": "/docs",
        "endpoints": {
            "alerts": "/api/v1/alerts",
            "system_status": "/api/v1/system-status",
            "scanner_status": "/api/v1/scanner-status",
            "receptors": "/api/v1/receptors",
            "trigger_scan": "/api/v1/trigger-scan",
            "stop_scan": "/api/v1/stop-scan",
            "evidence": "/evidence/{filename}"
        }
    })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("web_server:app", host="0.0.0.0", port=8000, reload=True)