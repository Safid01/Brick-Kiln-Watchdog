# 🛰️ Brick Kiln Watchdog: Autonomous Satellite Surveillance & GIS Compliance Platform

[![Python](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688.svg)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js-16%20Turbopack-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%2B-3178C6.svg)](https://www.typescriptlang.org/)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-00ffff.svg)](https://docs.ultralytics.com/)
[![GeoPandas](https://img.shields.io/badge/GeoPandas-1.0%2B-green.svg)](https://geopandas.org/)
[![License](https://img.shields.io/badge/License-Proprietary%20%2F%20DoE%20Bangladesh-red.svg)]()

An autonomous Earth Observation (EO) and Geospatial Information System (GIS) platform engineered for continuous aerial surveillance and automated environmental law enforcement across all **13 Districts of Greater Dhaka Division** (*Dhaka, Gazipur, Narayanganj, Tangail, Narsingdi, Manikganj, Munshiganj, Faridpur, Kishoreganj, Gopalganj, Madaripur, Rajbari, and Shariatpur*).

The platform continuously audits brick manufacturing sites against the **Bangladesh Brick Manufacturing and Kiln Construction (Control) Act**, mandating a **1,000-meter statutory buffer zone** around sensitive receptors (*schools, colleges, universities, hospitals, and clinics*) and enforcing the nationwide ban on **Fixed Chimney Bull's Trench Kilns (FCBTK)**.

---

## 🏗️ Architecture

The platform is cleanly separated into two cohesive tiers:

```
Browser (Inspector)
       │
       ▼
Next.js Frontend (frontend/ :3000)
  ├── Interactive Map (Leaflet / Esri / OSM satellite & street basemaps)
  ├── 1 km Statutory Buffer Rings & Sensitive Receptor GeoJSON Overlays
  ├── Situation Queue (Breach, Plume, FCBTK triage filter)
  ├── Real-time Scheduler HUD (Telemetry, Sweeper Countdown, On-Demand Scan)
  ├── Inspector Authentication & Rate-limited Cookie Sessions
  └── Active Learning Verification (Confirm authentic kilns / flag false positives)
       │
       ▼ (Server-side API & Evidence Proxy)
FastAPI Backend (web_server.py :8000)
  ├── SAHI Tiled Sliding-Window YOLOv8 Inference Engine
  ├── Physical & Multi-Spectral False Positive Filter
  ├── Continuous Background Surveillance Scheduler Daemon (120 s cycle)
  ├── Dynamic Live OpenStreetMap (OSM) Overpass Receptor Auto-Sync
  ├── Metric Geodesic Distance Vectors (UTM Zone 46N / EPSG:32646)
  └── Evidence Storage & JSON Alert Serializer (alerts_outbox/)
```

---

## 🌟 Key Capabilities

### 1. High-Precision Tiled Sliding-Window Inference (SAHI 1:1)
- Localized tiled sliding-window pipeline (640×640 window with 160px overlap) over high-resolution satellite imagery (Esri World Imagery, Zoom 16, ~2.1m/pixel).
- Resolves the 16× downsampling blur, quadrupling detection recall and mapping small, obscured, or clustered kilns that standard YOLO models miss.

### 2. Multi-Spectral & Physical False-Positive Filter
- Rejects spectral and morphological false alarms:
  - **Flat Zinc Tin Roofs**: Filtered by excessive high-frequency edge density and extreme brightness.
  - **Agricultural Paddy Fields & Water Reservoirs**: Filtered via HSV vegetation index ($H \in [35^\circ, 85^\circ]$) and low-reflectance water index.
  - **Physical Aspect Ratio Bounds**: Enforces physical kiln geometry ($35\text{m} \le \text{length} \le 160\text{m}$, aspect ratio $1.2 \le \text{AR} \le 3.5$).

### 3. Kiln Technology & Operational Classification
- **Technology Classification**:
  - **FCBTK (Fixed Chimney Bull's Trench Kiln)**: Oval trench, center fixed chimney — *Banned by statutory law*.
  - **Zigzag Kiln**: Rectangular or oval with zigzag firing path — *Permitted with conditional license*.
  - **Hoffman / Tunnel Kiln**: Rectangular permanent masonry composite — *Clean technology / Permitted*.
- **Combustion Plume Detection**:
  - Analyzes localized diffuse atmospheric haze, saturation suppression, and gradient contrast over the kiln chimney to classify operational status as **Active (Combustion Plume Detected)** or **Inactive (Seasonally Idle / Cold)**.
- **Physical Dimensions**: Automatically calculates real-world length ($\text{m}$), width ($\text{m}$), surface area ($\text{m}^2$), and estimated production capacity.

### 4. Continuous Background Surveillance Scheduler Daemon
- An autonomous daemon thread in `web_server.py` that continuously cycles and audits district sectors on a configurable timer (default: 120 seconds):
  $$\text{Savar} \longrightarrow \text{Gazipur} \longrightarrow \text{Narayanganj} \longrightarrow \text{Keraniganj} \longrightarrow \text{Nawabganj} \longrightarrow \text{OSM Receptor Sync} \longrightarrow \dots$$
- Includes live telemetry, countdown display, and pause/resume controls (`[⏸️ Pause]` / `[▶️ Resume]`).

### 5. Dynamic Live OpenStreetMap (OSM) Receptor Auto-Sync
- Actively queries Overpass API mirrors for newly registered schools and hospitals.
- Performs automated metric spatial deduplication ($\sim 33\text{m}$ threshold) and appends newly mapped facilities to `dhaka_region_receptors.geojson` (**3,190+ verified protected facilities active in memory**).
- Recalculates proximity breach vectors in metric UTM Zone 46N (`EPSG:32646`) across all active kilns, escalating any kiln within 1,000m to `CRITICAL` or `HIGH` breach tier.

### 6. Modern Interactive Inspector Dashboard & Active Learning
- **Strict Spatial Segregation**:
  - **Map Canvas**: Displays **ALL kilns detected across the division** (compliant kilns in emerald green, violations in amber/red, FCBTK with purple border, smoking with dashed halo).
  - **Sidebar Queue**: Strictly filters and displays **only kilns with active situations** (statutory breaches, active smoke plumes, or banned FCBTK).
- **Active Learning Feedback Loop**: Inspectors can verify (`[✅ Confirm]`) authentic detections or flag false alarms (`[❌ False Alarm]`), archiving labeled evidence crops into `dataset/` for automated retraining.

---

## 📁 Repository Structure

```
Brick Kiln Watchdog/
├── web_server.py                   # FastAPI REST API backend & background surveillance scheduler
├── alert_dispatcher.py             # Evidence crop generation & JSON alert serialization
├── detector_engine.py              # SAHI sliding-window inference, spectral filter, & metric proximity
├── osm_receptors.py                # Overpass API live query, deduplication, & buffer recalculation
├── run_pipeline.py                 # Multi-district CLI survey pipeline across Greater Dhaka
├── satellite_fetcher.py            # High-resolution Esri Zoom 16 composite stitcher
├── dhaka_region_receptors.geojson  # 3,190+ verified schools & hospitals database
├── requirements.txt                # Python backend dependencies
├── .gitignore                      # Git ignore patterns
│
├── frontend/                       # Unified Next.js Web GIS Inspector Dashboard
│   ├── app/                        # Next.js App Router (pages & server proxy API routes)
│   │   ├── api/                    # Proxy routes (/api/v1/*, /api/auth/*, /api/session)
│   │   ├── evidence/               # Evidence image streaming proxy (/evidence/*)
│   │   ├── globals.css             # Dark-theme GIS interface styles
│   │   ├── layout.tsx              # Root HTML/Head layout
│   │   └── page.tsx                # Dashboard view page
│   ├── components/                 # React components
│   │   ├── Dashboard.tsx           # Main inspector shell, filters, and polling coordinator
│   │   ├── MapView.tsx             # Interactive Leaflet map (satellite/street/OSM, buffers, receptors)
│   │   ├── AlertCard.tsx           # Kiln alert cards in the situation queue
│   │   ├── DetailPanel.tsx         # Inspector slide-out panel with evidence patch & stats
│   │   ├── ScannerHud.tsx          # Real-time daemon controls & telemetry display
│   │   └── LoginDialog.tsx         # Inspector login modal for mutations
│   ├── lib/                        # Client API wrappers, types, and server-side auth guards
│   ├── data/                       # Fallback snapshot data for offline demo mode
│   ├── deploy/                     # Production deployment scripts & systemd services
│   ├── .env.local                  # Environment configuration (connects to FastAPI backend)
│   └── package.json                # Frontend dependencies (Next.js 16, React 19, Leaflet)
│
├── weights/
│   └── kiln_detector.pt            # Pre-trained YOLOv8 convolutional weights (6.5 MB)
├── alerts_outbox/                  # Active kiln alert JSON files (160+ mapped sites)
│   └── rejected/                   # Archive for false alarms flagged by inspectors
├── evidence/                       # High-resolution evidence image crops for active alerts
├── dataset/                        # Active learning training datasets
│   ├── confirmed_kilns/            # Inspector-confirmed authentic kiln patches
│   └── false_positives/            # Inspector-flagged false positive patches
└── cache/                          # Cached satellite scene composites
```

---

## 🚀 Quickstart: Running Locally

> [!NOTE]
> The project uses your existing Python virtual environment on the **`N:` drive** (`N:\.venv`). You do not need to create a new virtual environment.

### Step 1: Start the Python FastAPI Backend

Open a terminal (PowerShell or Bash) in the project root:

```powershell
# Using the existing virtual environment on N: drive:
N:\.venv\Scripts\Activate.ps1

# Run the backend server:
python web_server.py
```

*Or run directly without activating:*
```powershell
& "N:\.venv\Scripts\python.exe" web_server.py
```

- The FastAPI backend will start on **`http://127.0.0.1:8000`**.
- The continuous background surveillance scheduler daemon automatically begins monitoring.
- Interactive Swagger API documentation is available at **`http://127.0.0.1:8000/docs`**.

---

### Step 2: Start the Next.js Frontend

Open a **second terminal** in the `frontend/` directory:

```powershell
cd "N:\Brick Kiln Watchdog\frontend"

# Install dependencies (only needed once):
npm install

# Start the Next.js development server:
npm run dev
```

- The Next.js frontend will start on **`http://localhost:3000`**.
- It is pre-configured via `frontend/.env.local` to connect directly to `http://127.0.0.1:8000`.

---

### Step 3: Open the Dashboard

Open your browser and navigate to:
```
http://localhost:3000
```

#### What you will see:
1. **Live Connection Indicator**: The top pill displays **`LIVE`** (connected to the FastAPI backend).
2. **Interactive GIS Platform**: Fullscreen dark-mode map loaded with Esri World Imagery, Street, and OpenStreetMap layers.
3. **Sidebar Situation Queue**: Real-time list of kilns needing attention (buffer breaches, active smoke plumes, banned FCBTKs).
4. **Surveillance HUD**: Real-time status of the autonomous district sweeper, countdown timer, and sector trigger controls.
5. **Inspector Actions**: Click `Confirm` or `False alarm` on any kiln card. When prompted, log in with password **`admin`** (defined in `frontend/.env.local`).

---

## ⚙️ Environment Configuration (`frontend/.env.local`)

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `BACKEND_URL` | `http://127.0.0.1:8000` | URL of the FastAPI backend. If empty, runs in offline demo mode. |
| `INSPECTOR_PASSWORD` | `admin` | Password required for Confirm / False alarm / Scan trigger / Pause actions. |
| `AUTH_SECRET` | `brick-kiln-watchdog-...` | 32+ character random string used to sign session cookies. |
| `COOKIE_SECURE` | `false` | Set to `false` for local HTTP development so browser accepts session cookies. |

---

## 📡 REST API Reference (`http://127.0.0.1:8000`)

The FastAPI backend exposes the following programmatic endpoints:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/` | `GET` | API landing card (HTML) or API metadata (JSON) pointing to Next.js frontend. |
| `/docs` | `GET` | Interactive Swagger UI API documentation. |
| `/api/v1/alerts` | `GET` | Returns list of all active kiln detections sorted by statutory priority tier. |
| `/api/v1/system-status` | `GET` | Returns system telemetry, data version signature, and aggregate KPI counts. |
| `/api/v1/scanner-status` | `GET` | Returns real-time scheduler state, current scanning sector, and countdown. |
| `/api/v1/receptors` | `GET` | Returns the complete GeoJSON FeatureCollection of 3,190+ sensitive receptors. |
| `/api/v1/trigger-scan` | `POST` | Triggers an immediate on-demand surveillance scan for a targeted sector (`ALL`, `Savar`, etc.) or `RECEPTORS`. |
| `/api/v1/auto-sweep/toggle` | `POST` | Toggles the autonomous background surveillance scheduler between `ACTIVE` and `PAUSED`. |
| `/api/v1/kilns/{id}/confirm` | `POST` | Marks detection as human-confirmed and exports evidence patch to `dataset/confirmed_kilns/`. |
| `/api/v1/kilns/{id}/reject` | `POST` | Flags detection as false positive, archives alert to `alerts_outbox/rejected/`, and exports patch to `dataset/false_positives/`. |
| `/evidence/{filename}` | `GET` | Serves satellite evidence crop images for active detections. |

---

## ⚖️ Statutory & Environmental Compliance Framework

This software automates compliance monitoring under the **Brick Manufacturing and Kiln Construction (Control) Act, 2013 (Amended 2019)**:

- **Section 8 (Prohibited Boundaries)**: Prohibits kiln construction within a **1,000-meter radius** of residential areas, schools, colleges, hospitals, and natural ecosystems.
  - $\text{Distance} < 500\text{m}$: Classified as **CRITICAL VIOLATION** (Immediate closure recommended).
  - $500\text{m} \le \text{Distance} < 1,000\text{m}$: Classified as **HIGH VIOLATION** (Regulatory penalty tier).
  - $\text{Distance} \ge 1,000\text{m}$: Classified as **COMPLIANT (NO RISK)**.
- **Section 5 (Banned Technologies)**: Fixed Chimney Bull's Trench Kilns (FCBTK) are strictly banned nationwide due to toxic particulate matter ($PM_{2.5}$ / $PM_{10}$) and sulfur dioxide emissions. Zigzag and Hoffman/Tunnel kilns require valid DoE environmental clearance certificates.

---

## 👨‍💻 Developer Notes & Contributing

- **Coordinate Reference Systems**:
  - Storage & Leaflet: Standard WGS 84 (`EPSG:4326`, Lat/Lon degrees).
  - Metric Distance Calculations: Projected into **UTM Zone 46N (`EPSG:32646`)**, ensuring all buffer radii and measurements are accurate in metric units.
- **Data Fingerprinting**: The server calculates an MD5 data signature (`compute_data_signature`) based on file count, sizes, and timestamps, allowing connected web clients to detect background updates instantly without polling full payloads.
