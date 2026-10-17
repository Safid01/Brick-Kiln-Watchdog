"""
Spatial Blacklist & Persistent False Positive Registry for Brick Kiln Watchdog.

Ensures that whenever an inspector marks a site as a False Positive, it is
permanently excluded by its GPS coordinates. Subsequent satellite scans
calculate geodesic distance (Haversine) and drop any candidates
detected within the exclusion radius (default 65.0 meters).
"""

import os
import sys
import glob
import json
import math
from datetime import datetime, timezone
from typing import List, Dict, Tuple, Optional

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

EXCLUSION_RADIUS_METERS = 65.0
BLACKLIST_FILE = "alerts_outbox/rejected/blacklist.json"
REJECTED_DIR = "alerts_outbox/rejected"
OUTBOX_DIR = "alerts_outbox"

def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate geodesic distance between two GPS coordinates in meters using the Haversine formula.
    """
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) *
         math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return R * c

def load_rejected_sites() -> List[Dict]:
    """
    Load all blacklisted/rejected false positive locations from:
    1. alerts_outbox/rejected/blacklist.json (central registry)
    2. alerts_outbox/rejected/*.json (individual archived dossiers)
    Deduplicates entries within 10 meters.
    """
    os.makedirs(REJECTED_DIR, exist_ok=True)
    sites: List[Dict] = []
    
    # 1. Load from blacklist.json registry if present
    if os.path.exists(BLACKLIST_FILE):
        try:
            with open(BLACKLIST_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                sites.extend(data.get("sites", []))
        except Exception as e:
            print(f"[Blacklist] Warning: could not load {BLACKLIST_FILE}: {e}")

    # 2. Load from all individual rejected files in alerts_outbox/rejected/
    for fpath in glob.glob(os.path.join(REJECTED_DIR, "*.json")):
        if os.path.basename(fpath).lower() == "blacklist.json":
            continue
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                d = json.load(f)
            coords = d.get("coordinates", {})
            lat = coords.get("latitude")
            lon = coords.get("longitude")
            if lat is not None and lon is not None:
                kiln_id = d.get("kiln_id", os.path.splitext(os.path.basename(fpath))[0])
                flagged_at = d.get("human_verification", {}).get("flagged_at", datetime.now(timezone.utc).isoformat())
                flagged_by = d.get("human_verification", {}).get("flagged_by", "DoE_Inspector")
                
                # Check if already present in sites
                already_present = any(
                    haversine_distance_m(lat, lon, s["latitude"], s["longitude"]) < 10.0
                    for s in sites
                )
                if not already_present:
                    sites.append({
                        "kiln_id": kiln_id,
                        "latitude": float(lat),
                        "longitude": float(lon),
                        "flagged_at": flagged_at,
                        "flagged_by": flagged_by,
                        "source_file": os.path.basename(fpath),
                        "reason": "Human inspector marked False Positive"
                    })
        except Exception as e:
            print(f"[Blacklist] Error reading {fpath}: {e}")

    if sites and not os.path.exists(BLACKLIST_FILE):
        save_blacklist_registry(sites)

    return sites

def save_blacklist_registry(sites: List[Dict]) -> None:
    """
    Persist the aggregated list of rejected sites to blacklist.json.
    """
    os.makedirs(REJECTED_DIR, exist_ok=True)
    payload = {
        "version": 1,
        "description": "Permanent spatial exclusion registry for rejected false alarms. Candidates within exclusion_radius_m are skipped during scans.",
        "exclusion_radius_m": EXCLUSION_RADIUS_METERS,
        "total_excluded_sites": len(sites),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sites": sites
    }
    tmp_path = BLACKLIST_FILE + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    os.replace(tmp_path, BLACKLIST_FILE)

def register_rejection(
    kiln_id: str,
    latitude: float,
    longitude: float,
    flagged_by: str = "DoE_Inspector",
    reason: str = "Inspector marked False Positive"
) -> Dict:
    """
    Register a newly rejected site in the permanent blacklist.
    """
    sites = load_rejected_sites()
    now_iso = datetime.now(timezone.utc).isoformat()
    
    matched = None
    for s in sites:
        if haversine_distance_m(latitude, longitude, s["latitude"], s["longitude"]) < 10.0:
            matched = s
            break
            
    if matched:
        matched["kiln_id"] = kiln_id
        matched["flagged_at"] = now_iso
        matched["flagged_by"] = flagged_by
        matched["reason"] = reason
        new_entry = matched
    else:
        new_entry = {
            "kiln_id": kiln_id,
            "latitude": float(latitude),
            "longitude": float(longitude),
            "flagged_at": now_iso,
            "flagged_by": flagged_by,
            "reason": reason
        }
        sites.append(new_entry)
        
    save_blacklist_registry(sites)
    return new_entry

def is_blacklisted(
    latitude: float,
    longitude: float,
    threshold_m: float = EXCLUSION_RADIUS_METERS
) -> Tuple[bool, Optional[Dict], float]:
    """
    Check if a candidate coordinate is within threshold_m of any rejected site.
    Returns (True, matched_site_dict, distance_m) if blacklisted, else (False, None, 0.0).
    """
    sites = load_rejected_sites()
    for s in sites:
        dist = haversine_distance_m(latitude, longitude, s["latitude"], s["longitude"])
        if dist <= threshold_m:
            return True, s, dist
    return False, None, 0.0

def purge_rejected_from_outbox(threshold_m: float = EXCLUSION_RADIUS_METERS) -> List[str]:
    """
    Scans alerts_outbox/BK-*.json and immediately deletes any files that match
    a blacklisted false positive within threshold_m.
    """
    purged = []
    sites = load_rejected_sites()
    if not sites:
        return purged

    for fpath in glob.glob(os.path.join(OUTBOX_DIR, "BK-*.json")):
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                d = json.load(f)
            coords = d.get("coordinates", {})
            lat = coords.get("latitude")
            lon = coords.get("longitude")
            if lat is None or lon is None:
                continue

            for s in sites:
                dist = haversine_distance_m(lat, lon, s["latitude"], s["longitude"])
                if dist <= threshold_m:
                    kiln_id = d.get("kiln_id", os.path.basename(fpath))
                    print(f"🧹 [Blacklist Purge] Removing active outbox dossier {kiln_id} ({fpath}) - matches rejected {s['kiln_id']} ({dist:.1f}m away)")
                    try:
                        os.remove(fpath)
                        purged.append(kiln_id)
                    except Exception as err:
                        print(f"Error removing {fpath}: {err}")
                    break
        except Exception as e:
            print(f"Error inspecting {fpath}: {e}")

    return purged
