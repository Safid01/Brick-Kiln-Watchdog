import requests
import geopandas as gpd
from shapely.geometry import Point
import os
import json
import glob
import math
from datetime import datetime

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
]

# Full Greater Dhaka Division 13 Districts Geographic Envelope
DHAKA_DIVISION_ENVELOPE = {
    "min_lat": 22.80,
    "min_lon": 89.30,
    "max_lat": 24.90,
    "max_lon": 91.20
}

def fetch_receptors_from_osm(
    min_lat=DHAKA_DIVISION_ENVELOPE["min_lat"],
    min_lon=DHAKA_DIVISION_ENVELOPE["min_lon"],
    max_lat=DHAKA_DIVISION_ENVELOPE["max_lat"],
    max_lon=DHAKA_DIVISION_ENVELOPE["max_lon"]
):
    """
    Standard loader: Reads offline cached regional dataset if available,
    otherwise queries Overpass API across the Greater Dhaka Division envelope.
    """
    for cache_path in ["dhaka_region_receptors.geojson", "savar_receptors.geojson"]:
        if os.path.exists(cache_path):
            try:
                gdf = gpd.read_file(cache_path)
                gdf["latitude"] = gdf.geometry.y
                gdf["longitude"] = gdf.geometry.x
                return gdf.to_crs("EPSG:32646")
            except Exception:
                pass
    
    return sync_osm_receptors_live(min_lat, min_lon, max_lat, max_lon).get("receptors_gdf")

def determine_region(lat, lon):
    """
    Classifies GPS coordinates into one of the 13 official districts of Dhaka Division
    (with sub-region resolution for Savar, Keraniganj, and Nawabganj within Dhaka District).
    """
    # 1. Dhaka Sub-sectors
    if 23.75 <= lat <= 23.92 and 90.18 <= lon <= 90.35:
        return "Savar"
    if 23.60 <= lat <= 23.75 and 90.30 <= lon <= 90.45:
        return "Keraniganj"
    if 23.60 <= lat <= 23.75 and 90.10 <= lon <= 90.28:
        return "Nawabganj"

    # 2. Tangail District (North-West)
    if 24.01 <= lat <= 24.80 and 89.70 <= lon <= 90.30:
        return "Tangail"

    # 3. Kishoreganj District (North-East)
    if 24.05 <= lat <= 24.68 and 90.58 <= lon <= 91.18:
        return "Kishoreganj"

    # 4. Gazipur District (North-Central)
    if 23.88 <= lat <= 24.35 and 90.15 <= lon <= 90.70:
        return "Gazipur"

    # 5. Narsingdi District (East)
    if 23.75 <= lat <= 24.25 and 90.55 <= lon <= 90.95:
        return "Narsingdi"

    # 6. Narayanganj District (South-East)
    if 23.53 <= lat <= 23.82 and 90.45 <= lon <= 90.76:
        return "Narayanganj"

    # 7. Manikganj District (West)
    if 23.63 <= lat <= 24.05 and 89.70 <= lon <= 90.28:
        return "Manikganj"

    # 8. Munshiganj District (South)
    if 23.38 <= lat <= 23.68 and 90.15 <= lon <= 90.72:
        return "Munshiganj"

    # 9. Faridpur District (South-West)
    if 23.28 <= lat <= 23.80 and 89.50 <= lon <= 90.25:
        return "Faridpur"

    # 10. Rajbari District (West)
    if 23.55 <= lat <= 23.88 and 89.30 <= lon <= 89.95:
        return "Rajbari"

    # 11. Gopalganj District (Far South)
    if 22.88 <= lat <= 23.38 and 89.65 <= lon <= 90.15:
        return "Gopalganj"

    # 12. Madaripur District (South)
    if 23.00 <= lat <= 23.50 and 89.95 <= lon <= 90.45:
        return "Madaripur"

    # 13. Shariatpur District (South-East)
    if 23.10 <= lat <= 23.45 and 90.20 <= lon <= 90.65:
        return "Shariatpur"

    # 14. Core Dhaka District (Remaining areas)
    if 23.53 <= lat <= 24.03 and 90.01 <= lon <= 90.58:
        return "Dhaka"

    return "Greater Dhaka"

def sync_osm_receptors_live(
    min_lat=DHAKA_DIVISION_ENVELOPE["min_lat"],
    min_lon=DHAKA_DIVISION_ENVELOPE["min_lon"],
    max_lat=DHAKA_DIVISION_ENVELOPE["max_lat"],
    max_lon=DHAKA_DIVISION_ENVELOPE["max_lon"],
    geojson_path="dhaka_region_receptors.geojson"
):
    """
    DYNAMIC LIVE OSM AUTO-SYNC FOR ALL 13 DISTRICTS:
    1. Actively queries Overpass API mirrors for newly mapped schools, colleges,
       hospitals, clinics, and kindergartens across Greater Dhaka Division.
    2. Performs spatial deduplication against existing points (~30m radius).
    3. Ingests new facilities into dhaka_region_receptors.geojson.
    4. Automatically recalculates buffer breach distances for all active kilns
       in alerts_outbox, upgrading priority tiers if a new receptor is closer.
    """
    headers = {
        "User-Agent": "BrickKilnWatchdog/2.0 (GIS Greater Dhaka Division Compliance; contact@doe.gov.bd)"
    }
    
    query = f"""
    [out:json][timeout:45];
    (
      node["amenity"~"school|college|university|hospital|clinic|kindergarten"]({min_lat},{min_lon},{max_lat},{max_lon});
      way["amenity"~"school|college|university|hospital|clinic|kindergarten"]({min_lat},{min_lon},{max_lat},{max_lon});
      node["building"~"school|hospital"]({min_lat},{min_lon},{max_lat},{max_lon});
      way["building"~"school|hospital"]({min_lat},{min_lon},{max_lat},{max_lon});
    );
    out center;
    """

    fetched_elements = []
    overpass_mirror_used = None

    for mirror in OVERPASS_MIRRORS:
        try:
            resp = requests.post(mirror, data={"data": query}, headers=headers, timeout=25)
            if resp.status_code == 200:
                data = resp.json()
                fetched_elements = data.get("elements", [])
                overpass_mirror_used = mirror
                break
        except Exception:
            continue

    # Load existing geojson database
    existing_geojson = {"type": "FeatureCollection", "features": []}
    if os.path.exists(geojson_path):
        try:
            with open(geojson_path, "r", encoding="utf-8") as f:
                existing_geojson = json.load(f)
        except Exception:
            pass

    existing_features = existing_geojson.get("features", [])
    existing_coords = []
    for feat in existing_features:
        coords = feat.get("geometry", {}).get("coordinates", [])
        if len(coords) == 2:
            existing_coords.append((float(coords[1]), float(coords[0]))) # (lat, lon)

    new_receptors_added = 0
    now_iso = datetime.now().isoformat()

    # Spatial deduplication threshold (~0.0003 deg ≈ 33 meters)
    dedup_threshold_sq = (0.00030) ** 2

    for elem in fetched_elements:
        lat = elem.get("lat") or (elem.get("center", {}).get("lat") if "center" in elem else None)
        lon = elem.get("lon") or (elem.get("center", {}).get("lon") if "center" in elem else None)
        if lat is None or lon is None:
            continue

        lat, lon = float(lat), float(lon)

        # Check proximity to existing receptors
        is_duplicate = False
        for ex_lat, ex_lon in existing_coords:
            dist_sq = (lat - ex_lat) ** 2 + (lon - ex_lon) ** 2
            if dist_sq < dedup_threshold_sq:
                is_duplicate = True
                break

        if not is_duplicate:
            tags = elem.get("tags", {})
            name = tags.get("name") or tags.get("name:en") or tags.get("operator") or "Unnamed Facility"
            amenity = tags.get("amenity") or tags.get("building") or "school"
            region = determine_region(lat, lon)

            new_feature = {
                "type": "Feature",
                "properties": {
                    "name": name,
                    "type": amenity,
                    "region": region,
                    "source": "OSM_Live_Sync",
                    "synced_at": now_iso
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(lon, 7), round(lat, 7)]
                }
            }
            existing_features.append(new_feature)
            existing_coords.append((lat, lon))
            new_receptors_added += 1

    # Save back to geojson if new facilities were ingested
    if new_receptors_added > 0:
        existing_geojson["features"] = existing_features
        with open(geojson_path, "w", encoding="utf-8") as f:
            json.dump(existing_geojson, f, indent=2, ensure_ascii=False)

    # Convert to GeoDataFrame in EPSG:32646 (Metric UTM) for proximity audit
    records = []
    for feat in existing_features:
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [0, 0])
        records.append({
            "name": props.get("name", "Unnamed Facility"),
            "type": props.get("type", "school"),
            "region": props.get("region", "Greater Dhaka"),
            "latitude": coords[1],
            "longitude": coords[0],
            "geometry": Point(coords[0], coords[1])
        })

    if records:
        gdf = gpd.GeoDataFrame(records, crs="EPSG:4326").to_crs("EPSG:32646")
    else:
        gdf = gpd.GeoDataFrame([], crs="EPSG:32646")

    # Recalculate proximity vectors for all active kiln alerts in alerts_outbox
    kilns_recalculated = 0
    escalated_kilns = []

    if len(gdf) > 0:
        for alert_file in glob.glob("alerts_outbox/BK-*.json"):
            try:
                with open(alert_file, "r", encoding="utf-8") as f:
                    alert_data = json.load(f)

                lat = alert_data.get("coordinates", {}).get("latitude")
                lon = alert_data.get("coordinates", {}).get("longitude")
                if lat is None or lon is None:
                    continue

                k_utm = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs("EPSG:32646")[0]
                dists = gdf.distance(k_utm)
                min_dist = float(dists.min())
                nearest_row = gdf.loc[dists.idxmin()]

                nearest_name = nearest_row["name"]
                nearest_type = nearest_row["type"]
                nearest_lat = float(nearest_row["latitude"])
                nearest_lon = float(nearest_row["longitude"])

                old_dist = alert_data.get("audit_metrics", {}).get("distance_to_receptor_m", 99999)
                old_tier = alert_data.get("audit_metrics", {}).get("priority_tier", "COMPLIANT")

                # If this facility is closer or upgrades breach tier
                if min_dist < old_dist or (min_dist < 1000.0 and old_tier == "COMPLIANT"):
                    new_tier = "CRITICAL" if min_dist < 500.0 else ("HIGH" if min_dist < 1000.0 else "COMPLIANT")
                    
                    alert_data["audit_metrics"]["distance_to_receptor_m"] = round(min_dist, 1)
                    alert_data["audit_metrics"]["nearest_receptor"] = nearest_name
                    alert_data["audit_metrics"]["receptor_type"] = nearest_type
                    alert_data["audit_metrics"]["priority_tier"] = new_tier
                    alert_data["audit_metrics"]["nearest_receptor_coords"] = {
                        "latitude": round(nearest_lat, 6),
                        "longitude": round(nearest_lon, 6)
                    }

                    if new_tier in ["CRITICAL", "HIGH"] and old_tier == "COMPLIANT":
                        escalated_kilns.append(alert_data.get("kiln_id", os.path.basename(alert_file)))

                    with open(alert_file, "w", encoding="utf-8") as f:
                        json.dump(alert_data, f, indent=2, ensure_ascii=False)
                    
                    kilns_recalculated += 1
            except Exception as ex:
                print(f"Error auditing alert {alert_file}: {ex}")

    status_summary = (
        f"OSM Receptor Sync: {new_receptors_added} newly mapped facilities ingested. "
        f"Total active receptors: {len(existing_features)}. "
        f"Recalculated {kilns_recalculated} kiln buffer distances."
    )
    if escalated_kilns:
        status_summary += f" ({len(escalated_kilns)} kilns elevated to breach priority tier: {', '.join(escalated_kilns[:3])})"

    return {
        "status": "SUCCESS",
        "overpass_mirror": overpass_mirror_used or "Cached / Fallback",
        "raw_queried": len(fetched_elements),
        "new_added": new_receptors_added,
        "total_receptors": len(existing_features),
        "kilns_recalculated": kilns_recalculated,
        "escalated_kilns": escalated_kilns,
        "summary": status_summary,
        "receptors_gdf": gdf
    }