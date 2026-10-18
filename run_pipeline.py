import os
import sys
import glob
import json
from satellite_fetcher import fetch_satellite_composite
from osm_receptors import fetch_receptors_from_osm, DHAKA_DIVISION_ENVELOPE
from detector_engine import LocalKilnDetector
from alert_dispatcher import create_evidence_crop, dispatch_alert
from spatial_blacklist import (
    is_blacklisted,
    purge_rejected_from_outbox,
    load_rejected_sites,
    haversine_distance_m
)

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ==============================================================================
# GREATER DHAKA DIVISION: 13 ADMINISTRATIVE DISTRICTS MASTER BOUNDS
# Total Area: ~20,500 km² covering the entire central industrial & brick belt
# ==============================================================================
DHAKA_DIVISION_BBOX = {
    "min_lat": 22.8000,
    "min_lon": 89.3000,
    "max_lat": 24.8500,
    "max_lon": 91.1800
}

DISTRICT_METADATA = {
    "Dhaka": {
        "name": "Dhaka District",
        "prefix": "DH",
        "bbox": {"min_lat": 23.5300, "min_lon": 90.0100, "max_lat": 24.0300, "max_lon": 90.5800},
        "description": "Savar, Keraniganj, Nawabganj, Dhamrai, Dohar, and Dhaka Metropolitan Area."
    },
    "Gazipur": {
        "name": "Gazipur District",
        "prefix": "GZ",
        "bbox": {"min_lat": 23.8800, "min_lon": 90.1500, "max_lat": 24.3500, "max_lon": 90.7000},
        "description": "Turag & Konabari corridor, Kaliakair, Sreepur, and Shitalakshya River basin."
    },
    "Narayanganj": {
        "name": "Narayanganj District",
        "prefix": "NJ",
        "bbox": {"min_lat": 23.5300, "min_lon": 90.4500, "max_lat": 23.8200, "max_lon": 90.7600},
        "description": "Shitalakshya and Meghna River basins, Sonargaon, Rupganj, and Araihazar."
    },
    "Tangail": {
        "name": "Tangail District",
        "prefix": "TG",
        "bbox": {"min_lat": 24.0100, "min_lon": 89.7000, "max_lat": 24.8000, "max_lon": 90.3000},
        "description": "Jamuna River floodplains, Mirzapur, Kalihati, Ghatail, and Tangail Sadar."
    },
    "Narsingdi": {
        "name": "Narsingdi District",
        "prefix": "NR",
        "bbox": {"min_lat": 23.7500, "min_lon": 90.5500, "max_lat": 24.2500, "max_lon": 90.9500},
        "description": "Meghna River industrial corridor, Palash Shitalakshya, Raipura, and Shibpur."
    },
    "Manikganj": {
        "name": "Manikganj District",
        "prefix": "MK",
        "bbox": {"min_lat": 23.6300, "min_lon": 89.7000, "max_lat": 24.0500, "max_lon": 90.2800},
        "description": "Dhaleshwari, Kaliganga, and Padma River confluences, Singair, and Shibalaya."
    },
    "Munshiganj": {
        "name": "Munshiganj District",
        "prefix": "MN",
        "bbox": {"min_lat": 23.3800, "min_lon": 90.1500, "max_lat": 23.6800, "max_lon": 90.7200},
        "description": "Meghna, Padma, and Dhaleshwari basins, Gazaria industrial belt, Sirajdikhan."
    },
    "Faridpur": {
        "name": "Faridpur District",
        "prefix": "FP",
        "bbox": {"min_lat": 23.2800, "min_lon": 89.5000, "max_lat": 23.8000, "max_lon": 90.2500},
        "description": "Padma and Kumar River floodplains, Bhanga junction, and Faridpur Sadar."
    },
    "Kishoreganj": {
        "name": "Kishoreganj District",
        "prefix": "KS",
        "bbox": {"min_lat": 24.0500, "min_lon": 90.5800, "max_lat": 24.6800, "max_lon": 91.1800},
        "description": "Bhairab major brick kiln hub, Meghna-Brahmaputra confluence, and Kuliarchar."
    },
    "Gopalganj": {
        "name": "Gopalganj District",
        "prefix": "GG",
        "bbox": {"min_lat": 22.8800, "min_lon": 89.6500, "max_lat": 23.3800, "max_lon": 90.1500},
        "description": "Madhumati River basin, Muksudpur, Kotalipara, and Gopalganj Sadar."
    },
    "Madaripur": {
        "name": "Madaripur District",
        "prefix": "MD",
        "bbox": {"min_lat": 23.0000, "min_lon": 89.9500, "max_lat": 23.5000, "max_lon": 90.4500},
        "description": "Padma Bridge southern approach corridor, Shibchar, and Arial Khan River."
    },
    "Rajbari": {
        "name": "Rajbari District",
        "prefix": "RB",
        "bbox": {"min_lat": 23.5500, "min_lon": 89.3000, "max_lat": 23.8800, "max_lon": 89.9500},
        "description": "Padma River banks, Goalanda Ghat confluence, Pangsha, and Gorai River basin."
    },
    "Shariatpur": {
        "name": "Shariatpur District",
        "prefix": "SP",
        "bbox": {"min_lat": 23.1000, "min_lon": 90.2000, "max_lat": 23.4500, "max_lon": 90.6500},
        "description": "Padma and Meghna River banks, Jajira, Naria, and Kirtinasha River basin."
    }
}

# ==============================================================================
# HIGH-PRIORITY SURVEY SECTORS (COVERING ALL 13 DISTRICTS OF DHAKA DIVISION)
# ==============================================================================
AUDIT_SECTORS = [
    # 1. Dhaka District (Including Savar, Keraniganj, Nawabganj, Dhamrai)
    {
        "region": "Savar",
        "district": "Dhaka",
        "prefix": "SV",
        "name": "Savar Central (Hemayetpur - Dhaleshwari)",
        "bbox": {"min_lat": 23.7700, "min_lon": 90.2400, "max_lat": 23.8200, "max_lon": 90.3050}
    },
    {
        "region": "Savar",
        "district": "Dhaka",
        "prefix": "SVE",
        "name": "Savar East (Aminbazar & Turag Kiln Belt)",
        "bbox": {"min_lat": 23.7700, "min_lon": 90.2950, "max_lat": 23.8250, "max_lon": 90.3550}
    },
    {
        "region": "Savar",
        "district": "Dhaka",
        "prefix": "SVN",
        "name": "Savar North (Ashulia & Bangshi River)",
        "bbox": {"min_lat": 23.8200, "min_lon": 90.2400, "max_lat": 23.8700, "max_lon": 90.3000}
    },
    {
        "region": "Keraniganj",
        "district": "Dhaka",
        "prefix": "KG",
        "name": "Keraniganj South (South Buriganga & Dhaleshwari)",
        "bbox": {"min_lat": 23.6200, "min_lon": 90.3600, "max_lat": 23.6700, "max_lon": 90.4200}
    },
    {
        "region": "Nawabganj",
        "district": "Dhaka",
        "prefix": "NW",
        "name": "Nawabganj (Ichamati & Kaliganga Basin)",
        "bbox": {"min_lat": 23.6500, "min_lon": 90.1400, "max_lat": 23.7400, "max_lon": 90.2300}
    },
    {
        "region": "Dhaka",
        "district": "Dhaka",
        "prefix": "DHM",
        "name": "Dhamrai (Bangshi & Dhaleshwari River Corridor)",
        "bbox": {"min_lat": 23.8800, "min_lon": 90.1400, "max_lat": 23.9500, "max_lon": 90.2400}
    },

    # 2. Gazipur District
    {
        "region": "Gazipur",
        "district": "Gazipur",
        "prefix": "GZ",
        "name": "Gazipur Central (Turag & Konabari Industrial Corridor)",
        "bbox": {"min_lat": 23.9600, "min_lon": 90.2800, "max_lat": 24.0100, "max_lon": 90.3400}
    },
    {
        "region": "Gazipur",
        "district": "Gazipur",
        "prefix": "GZK",
        "name": "Gazipur West (Kaliakair Industrial Corridor)",
        "bbox": {"min_lat": 24.0300, "min_lon": 90.1800, "max_lat": 24.1000, "max_lon": 90.2600}
    },
    {
        "region": "Gazipur",
        "district": "Gazipur",
        "prefix": "GZS",
        "name": "Gazipur East (Sreepur & Shitalakshya Basin)",
        "bbox": {"min_lat": 24.1200, "min_lon": 90.4200, "max_lat": 24.1900, "max_lon": 90.5000}
    },

    # 3. Narayanganj District
    {
        "region": "Narayanganj",
        "district": "Narayanganj",
        "prefix": "NJ",
        "name": "Narayanganj Central (Shitalakshya - Meghna Basin)",
        "bbox": {"min_lat": 23.6000, "min_lon": 90.5200, "max_lat": 23.6500, "max_lon": 90.5800}
    },
    {
        "region": "Narayanganj",
        "district": "Narayanganj",
        "prefix": "NJS",
        "name": "Narayanganj South (Sonargaon & Meghna Floodplains)",
        "bbox": {"min_lat": 23.6200, "min_lon": 90.6200, "max_lat": 23.6900, "max_lon": 90.7000}
    },
    {
        "region": "Narayanganj",
        "district": "Narayanganj",
        "prefix": "NJR",
        "name": "Narayanganj North (Rupganj Shitalakshya Corridor)",
        "bbox": {"min_lat": 23.7500, "min_lon": 90.5000, "max_lat": 23.8200, "max_lon": 90.5800}
    },

    # 4. Tangail District
    {
        "region": "Tangail",
        "district": "Tangail",
        "prefix": "TGM",
        "name": "Tangail South (Mirzapur & Louhajang River Corridor)",
        "bbox": {"min_lat": 24.0800, "min_lon": 90.0500, "max_lat": 24.1500, "max_lon": 90.1400}
    },
    {
        "region": "Tangail",
        "district": "Tangail",
        "prefix": "TGC",
        "name": "Tangail Central (Tangail Sadar & Jamuna Basin)",
        "bbox": {"min_lat": 24.2200, "min_lon": 89.8800, "max_lat": 24.3000, "max_lon": 89.9700}
    },
    {
        "region": "Tangail",
        "district": "Tangail",
        "prefix": "TGK",
        "name": "Tangail North (Kalihati & Bangshi Floodplains)",
        "bbox": {"min_lat": 24.3500, "min_lon": 89.9600, "max_lat": 24.4200, "max_lon": 90.0500}
    },

    # 5. Narsingdi District
    {
        "region": "Narsingdi",
        "district": "Narsingdi",
        "prefix": "NRP",
        "name": "Narsingdi West (Palash Shitalakshya Corridor)",
        "bbox": {"min_lat": 23.9200, "min_lon": 90.6000, "max_lat": 23.9900, "max_lon": 90.6900}
    },
    {
        "region": "Narsingdi",
        "district": "Narsingdi",
        "prefix": "NRC",
        "name": "Narsingdi Central (Meghna Floodplain & Sadar)",
        "bbox": {"min_lat": 23.8800, "min_lon": 90.7000, "max_lat": 23.9500, "max_lon": 90.7900}
    },
    {
        "region": "Narsingdi",
        "district": "Narsingdi",
        "prefix": "NRR",
        "name": "Narsingdi East (Raipura Meghna Confluence)",
        "bbox": {"min_lat": 23.9600, "min_lon": 90.8400, "max_lat": 24.0400, "max_lon": 90.9300}
    },

    # 6. Manikganj District
    {
        "region": "Manikganj",
        "district": "Manikganj",
        "prefix": "MKS",
        "name": "Manikganj East (Singair Dhaleshwari Basin)",
        "bbox": {"min_lat": 23.7700, "min_lon": 90.1200, "max_lat": 23.8500, "max_lon": 90.2200}
    },
    {
        "region": "Manikganj",
        "district": "Manikganj",
        "prefix": "MKC",
        "name": "Manikganj Central (Kaliganga Basin & Sadar)",
        "bbox": {"min_lat": 23.8200, "min_lon": 89.9800, "max_lat": 23.9000, "max_lon": 90.0800}
    },
    {
        "region": "Manikganj",
        "district": "Manikganj",
        "prefix": "MKW",
        "name": "Manikganj West (Shibalaya & Padma Confluence)",
        "bbox": {"min_lat": 23.8000, "min_lon": 89.7800, "max_lat": 23.8800, "max_lon": 89.8800}
    },

    # 7. Munshiganj District
    {
        "region": "Munshiganj",
        "district": "Munshiganj",
        "prefix": "MNG",
        "name": "Munshiganj East (Gazaria Meghna Basin)",
        "bbox": {"min_lat": 23.5200, "min_lon": 90.5800, "max_lat": 23.6000, "max_lon": 90.6800}
    },
    {
        "region": "Munshiganj",
        "district": "Munshiganj",
        "prefix": "MNS",
        "name": "Munshiganj Central (Sirajdikhan & Dhaleshwari)",
        "bbox": {"min_lat": 23.5700, "min_lon": 90.3200, "max_lat": 23.6400, "max_lon": 90.4100}
    },
    {
        "region": "Munshiganj",
        "district": "Munshiganj",
        "prefix": "MNP",
        "name": "Munshiganj South (Tongibari & Padma Corridor)",
        "bbox": {"min_lat": 23.4600, "min_lon": 90.4400, "max_lat": 23.5300, "max_lon": 90.5300}
    },

    # 8. Faridpur District
    {
        "region": "Faridpur",
        "district": "Faridpur",
        "prefix": "FPC",
        "name": "Faridpur Central (Faridpur Sadar & Padma Bank)",
        "bbox": {"min_lat": 23.5600, "min_lon": 89.8000, "max_lat": 23.6400, "max_lon": 89.8900}
    },
    {
        "region": "Faridpur",
        "district": "Faridpur",
        "prefix": "FPB",
        "name": "Faridpur South (Bhanga Transport Corridor)",
        "bbox": {"min_lat": 23.3500, "min_lon": 89.9400, "max_lat": 23.4300, "max_lon": 90.0300}
    },
    {
        "region": "Faridpur",
        "district": "Faridpur",
        "prefix": "FPM",
        "name": "Faridpur West (Madhukhali & Chandana Basin)",
        "bbox": {"min_lat": 23.5000, "min_lon": 89.6000, "max_lat": 23.5800, "max_lon": 89.7000}
    },

    # 9. Kishoreganj District
    {
        "region": "Kishoreganj",
        "district": "Kishoreganj",
        "prefix": "KSB",
        "name": "Kishoreganj South (Bhairab Meghna Brick Hub)",
        "bbox": {"min_lat": 24.0200, "min_lon": 90.9400, "max_lat": 24.0900, "max_lon": 91.0300}
    },
    {
        "region": "Kishoreganj",
        "district": "Kishoreganj",
        "prefix": "KSK",
        "name": "Kishoreganj Central (Kuliarchar & Meghna Corridor)",
        "bbox": {"min_lat": 24.1200, "min_lon": 90.8700, "max_lat": 24.1900, "max_lon": 90.9600}
    },
    {
        "region": "Kishoreganj",
        "district": "Kishoreganj",
        "prefix": "KSC",
        "name": "Kishoreganj North (Old Brahmaputra Basin & Sadar)",
        "bbox": {"min_lat": 24.4000, "min_lon": 90.7400, "max_lat": 24.4700, "max_lon": 90.8300}
    },

    # 10. Gopalganj District
    {
        "region": "Gopalganj",
        "district": "Gopalganj",
        "prefix": "GGC",
        "name": "Gopalganj Central (Gopalganj Sadar & Madhumati)",
        "bbox": {"min_lat": 23.0000, "min_lon": 89.7800, "max_lat": 23.0800, "max_lon": 89.8700}
    },
    {
        "region": "Gopalganj",
        "district": "Gopalganj",
        "prefix": "GGM",
        "name": "Gopalganj North (Muksudpur Brick Corridor)",
        "bbox": {"min_lat": 23.2800, "min_lon": 89.8300, "max_lat": 23.3600, "max_lon": 89.9200}
    },

    # 11. Madaripur District
    {
        "region": "Madaripur",
        "district": "Madaripur",
        "prefix": "MDS",
        "name": "Madaripur North (Shibchar Padma Bridge Corridor)",
        "bbox": {"min_lat": 23.3800, "min_lon": 90.1200, "max_lat": 23.4600, "max_lon": 90.2200}
    },
    {
        "region": "Madaripur",
        "district": "Madaripur",
        "prefix": "MDC",
        "name": "Madaripur Central (Arial Khan River & Sadar)",
        "bbox": {"min_lat": 23.1400, "min_lon": 90.1600, "max_lat": 23.2200, "max_lon": 90.2500}
    },

    # 12. Rajbari District
    {
        "region": "Rajbari",
        "district": "Rajbari",
        "prefix": "RBG",
        "name": "Rajbari East (Goalanda Ghat Padma Corridor)",
        "bbox": {"min_lat": 23.6800, "min_lon": 89.7200, "max_lat": 23.7600, "max_lon": 89.8200}
    },
    {
        "region": "Rajbari",
        "district": "Rajbari",
        "prefix": "RBC",
        "name": "Rajbari Central (Rajbari Sadar & Padma Embankment)",
        "bbox": {"min_lat": 23.7200, "min_lon": 89.5800, "max_lat": 23.8000, "max_lon": 89.6800}
    },

    # 13. Shariatpur District
    {
        "region": "Shariatpur",
        "district": "Shariatpur",
        "prefix": "SPJ",
        "name": "Shariatpur North (Jajira Padma River Corridor)",
        "bbox": {"min_lat": 23.3000, "min_lon": 90.2800, "max_lat": 23.3800, "max_lon": 90.3800}
    },
    {
        "region": "Shariatpur",
        "district": "Shariatpur",
        "prefix": "SPN",
        "name": "Shariatpur Central (Naria Kirtinasha Basin)",
        "bbox": {"min_lat": 23.2200, "min_lon": 90.3600, "max_lat": 23.2900, "max_lon": 90.4500}
    }
]

def generate_seamless_grid_sectors(bbox, region_name, prefix, step_lat=0.06, step_lon=0.07, overlap=0.008):
    """
    Subdivides any district bounding box into seamlessly contiguous scanning sectors.
    The overlap parameter ensures that boundaries overlap by ~850 meters, guaranteeing
    that NO kiln on any boundary line is ever cut or missed ('without missing any inch on the map').
    """
    min_lat, max_lat = float(bbox["min_lat"]), float(bbox["max_lat"])
    min_lon, max_lon = float(bbox["min_lon"]), float(bbox["max_lon"])

    sectors = []
    lat_cursor = min_lat
    row = 1

    while lat_cursor < max_lat:
        next_lat = min(lat_cursor + step_lat, max_lat)
        cell_min_lat = max(min_lat, lat_cursor - (overlap if lat_cursor > min_lat else 0.0))
        cell_max_lat = min(max_lat, next_lat + (overlap if next_lat < max_lat else 0.0))

        lon_cursor = min_lon
        col = 1
        while lon_cursor < max_lon:
            next_lon = min(lon_cursor + step_lon, max_lon)
            cell_min_lon = max(min_lon, lon_cursor - (overlap if lon_cursor > min_lon else 0.0))
            cell_max_lon = min(max_lon, next_lon + (overlap if next_lon < max_lon else 0.0))

            sector_code = f"{prefix}G{row:02d}{col:02d}"
            sectors.append({
                "region": region_name,
                "district": region_name,
                "prefix": sector_code,
                "name": f"{region_name} Continuous Grid (R{row:02d}C{col:02d})",
                "bbox": {
                    "min_lat": round(cell_min_lat, 4),
                    "min_lon": round(cell_min_lon, 4),
                    "max_lat": round(cell_max_lat, 4),
                    "max_lon": round(cell_max_lon, 4)
                }
            })
            lon_cursor = next_lon
            col += 1

        lat_cursor = next_lat
        row += 1

    return sectors

# Optional Telegram credentials
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", None)
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", None)

def run(selected_sectors=None, custom_bbox=None, full_grid=False, conf_threshold=0.35, max_sectors=None, progress_callback=None, cancel_check=None):
    """
    Surveillance Pipeline across Greater Dhaka Division:
    - selected_sectors: List of district names or sector prefixes (e.g. ['Tangail', 'Narsingdi'] or ['ALL'])
    - custom_bbox: Dict with {min_lat, min_lon, max_lat, max_lon} to scan any user-defined bounding box
    - full_grid: If True, generates a dense seamless overlapping grid mesh across the entire bounding box
    - conf_threshold: YOLOv8 confidence threshold (default: 0.35 for high-precision verification)
    """
    print("================================================================")
    print("🛰️  BRICK KILN WATCHDOG: GREATER DHAKA DIVISION SURVEILLANCE")
    print("    Inference: Tiled Sliding-Window (SAHI 1:1, 40% Overlap) + Multi-Spectral")
    print("    Expanded Coverage: 13 Districts of Greater Dhaka Division")
    print("    (Dhaka, Gazipur, Narayanganj, Tangail, Narsingdi, Manikganj,")
    print("     Munshiganj, Faridpur, Kishoreganj, Gopalganj, Madaripur, Rajbari, Shariatpur)")
    print("================================================================")

    os.makedirs("evidence", exist_ok=True)
    os.makedirs("alerts_outbox", exist_ok=True)
    os.makedirs("alerts_outbox/rejected", exist_ok=True)
    os.makedirs("cache", exist_ok=True)

    # Clean outbox and load spatial blacklist
    purge_rejected_from_outbox()
    rejected_sites = load_rejected_sites()
    if rejected_sites:
        print(f"🛡️  Spatial Blacklist Active: {len(rejected_sites)} permanently excluded false-positive sites loaded.")

    # 1. Load Receptors covering the entire Greater Dhaka Division envelope
    print("\n[Step 1] Loading verified protected facilities across Greater Dhaka Division...")
    receptors = fetch_receptors_from_osm()
    print(f"✓ Total protected facilities active in memory: {len(receptors) if receptors is not None else 0}")

    detector = LocalKilnDetector(weights_path="weights/kiln_detector.pt")

    # Determine sectors to run
    sectors_to_run = []
    
    if custom_bbox:
        print(f"\n[Custom Bounding Box Active] Generating seamless overlapping surveillance grid...")
        sectors_to_run = generate_seamless_grid_sectors(
            bbox=custom_bbox,
            region_name="CustomSector",
            prefix="CB",
            step_lat=0.06,
            step_lon=0.07,
            overlap=0.008
        )
    elif selected_sectors and "ALL" not in [str(s).upper() for s in selected_sectors]:
        # Filter matching districts or sector prefixes
        targets = set(selected_sectors)
        for s in AUDIT_SECTORS:
            if s["region"] in targets or s.get("district") in targets or s["prefix"] in targets:
                sectors_to_run.append(s)

        # If user specified a district that requested full continuous grid coverage
        if full_grid:
            for dist_name in targets:
                if dist_name in DISTRICT_METADATA:
                    dmeta = DISTRICT_METADATA[dist_name]
                    grid_cells = generate_seamless_grid_sectors(
                        bbox=dmeta["bbox"],
                        region_name=dist_name,
                        prefix=dmeta["prefix"],
                        step_lat=0.06,
                        step_lon=0.07,
                        overlap=0.008
                    )
                    sectors_to_run.extend(grid_cells)
    else:
        # Full scan: Run all high-density sectors across all 13 districts
        sectors_to_run = AUDIT_SECTORS

    if max_sectors and len(sectors_to_run) > max_sectors:
        sectors_to_run = sectors_to_run[:max_sectors]

    print(f"\n[Step 2] Executing surveillance sweep across {len(sectors_to_run)} sectors...")

    total_audited = 0
    total_violations = 0
    districts_covered = set()

    for idx, sector in enumerate(sectors_to_run, 1):
        if cancel_check and cancel_check():
            print("⚠️ Surveillance scan cancelled by user request.")
            break
        if progress_callback:
            try:
                progress_callback(idx, len(sectors_to_run), sector)
            except Exception:
                pass
        reg = sector["region"]
        district = sector.get("district", reg)
        districts_covered.add(district)
        prefix = sector["prefix"]
        name = sector["name"]
        bbox = sector["bbox"]
        scene_file = f"cache/{prefix}_scene.jpg"

        print(f"\n--- [Sector {idx}/{len(sectors_to_run)}] {name} ({district}) ---")
        print(f"Acquiring high-res satellite composite for bbox: {bbox}...")
        try:
            scene_path, bounds = fetch_satellite_composite(
                min_lat=bbox["min_lat"],
                min_lon=bbox["min_lon"],
                max_lat=bbox["max_lat"],
                max_lon=bbox["max_lon"],
                zoom=16,
                output_path=scene_file
            )
        except Exception as e:
            print(f"⚠️ Error acquiring satellite composite for {prefix}: {e}")
            continue

        print(f"Executing Tiled Sliding Window Inference (SAHI 1:1, 40% Overlap) & Multi-Spectral Filter...")
        findings = detector.audit_scene(
            image_path=scene_path,
            bounds=bounds,
            receptors_gdf=receptors,
            conf_threshold=conf_threshold
        )

        # Spatial Blacklist Filtering: Skip candidates matching permanently rejected false alarms
        active_candidates = []
        excluded_count = 0
        for cand in findings:
            lat = cand["latitude"]
            lon = cand["longitude"]
            blacklisted, matched_rej, dist_m = is_blacklisted(lat, lon)
            if blacklisted:
                excluded_count += 1
                rej_id = matched_rej.get("kiln_id", "Unknown") if matched_rej else "Unknown"
                print(f"  🚫 [Permanent False Positive Excluded] Skipped site at ({lat:.5f}, {lon:.5f}) - matches rejected false alarm {rej_id} ({dist_m:.1f}m away)")
            else:
                active_candidates.append(cand)

        print(f"✓ Found {len(active_candidates)} active brick kilns in {district} ({excluded_count} permanently excluded false positives dropped).")

        # Collect all rejected IDs in this sector so retired IDs are never reused
        rejected_ids = set()
        for fpath in glob.glob(f"alerts_outbox/rejected/BK-{prefix}-*.json"):
            rejected_ids.add(os.path.splitext(os.path.basename(fpath))[0])
        for s in rejected_sites:
            if s.get("kiln_id", "").startswith(f"BK-{prefix}-"):
                rejected_ids.add(s["kiln_id"])

        # Load existing active alerts in this sector to maintain stable IDs and preserve human verifications
        existing_alerts = []
        used_ids = set(rejected_ids)
        for fpath in glob.glob(f"alerts_outbox/BK-{prefix}-*.json"):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    ea = json.load(f)
                c = ea.get("coordinates", {})
                kid = ea.get("kiln_id", os.path.splitext(os.path.basename(fpath))[0])
                if kid in rejected_ids:
                    try:
                        os.remove(fpath)
                    except Exception as e:
                        print(f"Error removing rejected file {fpath}: {e}")
                    continue
                if "latitude" in c and "longitude" in c:
                    existing_alerts.append(ea)
                    used_ids.add(kid)
            except Exception:
                pass

        for item in active_candidates:
            total_audited += 1
            lat = item["latitude"]
            lon = item["longitude"]

            matched_ea = None
            min_dist = 999999.0
            for ea in existing_alerts:
                c = ea.get("coordinates", {})
                d = haversine_distance_m(lat, lon, c["latitude"], c["longitude"])
                if d <= 65.0 and d < min_dist:
                    min_dist = d
                    matched_ea = ea

            if matched_ea:
                kiln_id = matched_ea["kiln_id"]
                if "human_verification" in matched_ea and matched_ea["human_verification"]:
                    item["human_verification"] = matched_ea["human_verification"]
                    item["status"] = matched_ea.get("status", "VERIFIED_ACTIVE")
            else:
                seq = 1
                while f"BK-{prefix}-{seq:03d}" in used_ids:
                    seq += 1
                kiln_id = f"BK-{prefix}-{seq:03d}"
                used_ids.add(kiln_id)

            item["kiln_id"] = kiln_id
            item["region"] = reg
            item["district"] = district
            item["sector_name"] = name

            crop_path = f"evidence/{kiln_id}_patch.jpg"
            create_evidence_crop(scene_path, item["pixel_bbox"], crop_path)

            if item["is_violation"]:
                total_violations += 1

            dispatch_alert(
                finding=item,
                evidence_img_path=crop_path,
                telegram_token=TELEGRAM_BOT_TOKEN if item["is_violation"] else None,
                telegram_chat_id=TELEGRAM_CHAT_ID if item["is_violation"] else None
            )

            status_icon = "🚨" if item["is_violation"] else "✅"
            tech_badge = item["technology"]["badge"]
            dim_str = f"{item['dimensions']['length_m']}m×{item['dimensions']['width_m']}m"

            print(f"  {status_icon} [{item['priority_tier']}] {kiln_id} | {tech_badge} | {dim_str} | Dist: {item['min_distance_m']}m to '{item['nearest_facility_name']}'")

    # Final purge guarantee
    purge_rejected_from_outbox()

    print("\n================================================================")
    print("✅ REGIONAL COMPLIANCE AUDIT COMPLETED")
    print(f"  - Total Kilns Audited: {total_audited}")
    print(f"  - Statutory Buffer Breaches (<1,000m): {total_violations}")
    print(f"  - Districts Audited ({len(districts_covered)}): {', '.join(sorted(districts_covered))}")
    print(f"Evidence Patches: ./evidence/")
    print(f"Web JSON Dossiers: ./alerts_outbox/")
    print("================================================================")
    return {
        "status": "COMPLETED",
        "total_audited": total_audited,
        "total_violations": total_violations,
        "districts_audited": sorted(list(districts_covered)),
        "sectors_audited": [s["name"] for s in sectors_to_run]
    }

if __name__ == "__main__":
    run()