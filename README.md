# 🛰️ Brick Kiln Watchdog: Autonomous Satellite Surveillance & GIS Compliance Platform

[![Python](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.143%2B-009688.svg)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js-16%20Turbopack-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%2B-3178C6.svg)](https://www.typescriptlang.org/)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-00ffff.svg)](https://docs.ultralytics.com/)
[![GeoPandas](https://img.shields.io/badge/GeoPandas-1.0%2B-green.svg)](https://geopandas.org/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9%2B-brightgreen.svg)](https://leafletjs.com/)

An Earth Observation (EO) and Geospatial Information System (GIS) platform engineered for aerial surveillance, satellite monitoring, and environmental law enforcement across all **13 Districts of Greater Dhaka Division** (*Dhaka, Gazipur, Narayanganj, Tangail, Narsingdi, Manikganj, Munshiganj, Faridpur, Kishoreganj, Gopalganj, Madaripur, Rajbari, and Shariatpur*).

The platform continuously audits brick manufacturing sites against the **Bangladesh Brick Manufacturing and Kiln Construction (Control) Act**, mandating a **1,000-meter statutory buffer zone** around sensitive receptors (*schools, colleges, universities, hospitals, and clinics*) and monitoring the nationwide ban on **Fixed Chimney Bull's Trench Kilns (FCBTK)**.

---

## 🏗️ Architecture

The platform is organized into two communicating tiers:

```
Browser (Inspector / Operator)
       │
       ▼
Next.js Frontend (frontend/ · http://localhost:3000)
  ├── Interactive Leaflet Map (Satellite & Street Basemaps)
  ├── 1 km Statutory Buffer Rings & Sensitive Receptor GeoJSON Overlays
  ├── District Boundaries (13 Greater Dhaka Districts)
  ├── Dual Theme System: Dark Mode & Bluish Light Mode (Sliding Switch)
  ├── Summary KPI Strip (Mapped, Situations in #E11A45, Buffer Breaches in #FFCD54/#ea580c)
  ├── District Navigation Bar (Chevron Scroll, Wheel Scroll, Boxed Active District)
  ├── Review Queue Sidebar (Kiln ID & District Badges, Statutory Buffer Bars, FCBTK Badges)
  ├── Interactive Kiln Placement (+ Add Kiln Mode & Coordinate Reverse-Geocoding)
  ├── Scanner HUD & Live Progress Strip (Progress Bar, Sector Counter, ETA, Stop Scan)
  └── Inspector Authentication (HttpOnly rate-limited session cookies for mutations)
       │
       ▼ (Server-side API & Evidence Proxy)
FastAPI Backend (web_server.py · http://127.0.0.1:8000)
  ├── Tiled Sliding-Window YOLOv8 Inference Engine (SAHI 1:1)
  ├── Spectral & Morphological False Positive Filtering
  ├── Metric Geodesic Distance Calculations (UTM Zone 46N / EPSG:32646)
  ├── OpenStreetMap (OSM) Sensitive Receptors Database (3,190+ Facilities)
  ├── On-Demand Sector Scanning with Live Step Reporting & Immediate Stop Scan
  ├── Manual Kiln Add & Reverse Geocoding with Satellite Patch Capture
  ├── Spatial Blacklist (Automated Rejection Purge & Persistent Exclusion)
  └── Evidence Image Storage & JSON Alert Dossier Serializer (alerts_outbox/)
```

---

## 🌟 Implemented Features

### 1. Interactive Web GIS Map
- **Dual Basemap**: High-resolution Esri World Imagery (Satellite) and Esri World Street map.
- **Statutory 1 km Buffer Rings**: Visual circular danger rings around detected kilns to highlight buffer breaches.
- **Sensitive Receptor Network**: Database of **3,190+ schools, colleges, and hospitals** across Greater Dhaka Division loaded via GeoJSON with interactive pins and metadata tooltips.
- **Vector Proximity Tracing**: Clicking **Trace** on any kiln zooms the map, draws a direct vector line to the nearest protected facility, and calculates real-time metric distance.
- **District Boundary Overlays**: Visual boundary polygons and centered district labels for all 13 administrative districts.

### 2. Dual Theme Engine: Dark Mode & Bluish-Toned Light Mode
- **Sleek Toggle Switch**: Custom sliding pill switch in the top bar with animated sun and moon indicators.
- **Bluish Light Palette (No Plain White)**: Built with cool steel-blue (`#c9dbed`), frosty ice-blue (`#d6e5f3`), and sky-slate (`#e4eef8`) surfaces with deep navy typography (`#0b1e36`) to avoid harsh white glare.
- **Persistent Storage**: Retains theme preference via `localStorage` with an anti-flicker head bootstrap script.

### 3. Topbar Summary KPIs
- **Mapped**: Total number of mapped kilns in the system.
- **Situations**: Distinct count styled in **`#E11A45`** (real red) across both dark and light modes.
- **Buffer Breaches**: Violation count styled in **`#FFCD54`** in dark mode and rich vibrant orange (**`#ea580c`**) in light mode.

### 4. District Navigation Bar
- Complete coverage of Greater Dhaka: **All**, **Dhaka**, **Gazipur**, **Narayanganj**, **Tangail**, **Narsingdi**, **Manikganj**, **Munshiganj**, **Faridpur**, **Kishoreganj**, **Gopalganj**, **Madaripur**, **Rajbari**, and **Shariatpur**.
- **Boxed Active District**: Selected district is highlighted with a crisp border box and accent background container around the district name and count (no underline).
- **Smooth Navigation**: Horizontal scrolling via left `<` and right `>` chevron buttons, mouse wheel horizontal scrolling, and custom thin scrollbars.

### 5. On-Demand Live Scan & Stop Scan
- **Targeted Sector Scanning**: Ability to scan all 13 districts or target a specific district via the HUD dropdown.
- **Live Progress Strip**: Displays an active pulse dot, currently audited sector, step counter (e.g., `Sector 2/13`), live animated progress percentage bar, and dynamic estimated time remaining (**ETA**).
- **Stop Scan Button**: Immediate scan abort control with stop icon (`IconStop`) available in both the Scanner HUD and progress banner, triggering instant backend loop termination via `POST /api/v1/stop-scan`.

### 6. Sidebar Review Queue & Active Learning
- **Triage Filters**: Instant filtering by `Situations`, `Critical`, `High`, `Safe`, `FCBTK`, and `All kilns`.
- **Review Queue Stats**: Displays active situation count and audit tracking (`X of Y kilns audited · Z pending`).
- **Card Hierarchy**:
  - Prominent **Kiln ID** (e.g., `BK-NRP-006`) and **District Badge** (e.g., `📍 Narsingdi`).
  - Metric distance to nearest receptor with color-coded buffer ratio bar.
  - Technology classification badge (`FCBTK (Banned)`, `Zigzag`, `Hoffman/Tunnel`) with high contrast in both themes.
  - Model confidence percentage.
  - Statutory tier badge (`CRITICAL`, `HIGH`, `COMPLIANT`).
- **Active Learning Verification**:
  - `Confirm`: Marks detection as human-verified and saves the satellite patch into `dataset/confirmed_kilns/`.
  - `False alarm`: Blacklists the GPS coordinates, removes the alert from active view, moves the dossier to `alerts_outbox/rejected/`, and archives the patch into `dataset/false_positives/`.

### 7. Interactive Kiln Placement (`+ Add kiln`)
- Activate Add Kiln mode from the top bar to display the floating crosshair banner (*"Add kiln mode. Click a spot on the map to place a kiln."*).
- Clicking any point on the map reverse-geocodes the district, queries the nearest sensitive receptor in UTM Zone 46N, assigns a sequential Kiln ID, fetches a centered satellite evidence crop, and creates an alert record.

### 8. Slide-Out Detail Panel
- Inspects selected kiln with high-resolution satellite evidence crop image.
- Physical kiln dimensions: length ($\text{m}$), width ($\text{m}$), surface area ($\text{m}^2$), aspect ratio, and estimated brick production capacity.
- Displays nearest sensitive receptor name, facility type, and exact coordinates.
- Technology selector dropdown to re-classify kiln technology between FCBTK, Zigzag, and Hoffman/Tunnel.

---

## 📁 Repository Structure

```
Brick Kiln Watchdog/
├── web_server.py                   # FastAPI REST API backend & scan pipeline coordinator
├── run_pipeline.py                 # Multi-district satellite survey execution pipeline
├── detector_engine.py              # YOLOv8 inference, spectral filters, & metric proximity
├── satellite_fetcher.py            # High-resolution Esri satellite composite fetcher & stitcher
├── spatial_blacklist.py            # Spatial blacklist & false-positive site exclusion logic
├── alert_dispatcher.py             # Evidence crop generation & JSON alert serialization
├── osm_receptors.py                # Overpass API live receptor sync & UTM 46N buffer queries
├── dhaka_region_receptors.geojson  # 3,190+ verified schools & hospitals database
├── requirements.txt                # Python backend dependencies
├── README.md                       # Platform documentation
│
├── frontend/                       # Next.js Web GIS Inspector Dashboard
│   ├── app/                        # Next.js App Router
│   │   ├── api/                    # Server-side proxy routes (/api/v1/*, /api/auth/*, /api/session)
│   │   ├── evidence/               # Satellite evidence image proxy (/evidence/*)
│   │   ├── globals.css             # Design system (Dark & Bluish Light mode tokens, UI components)
│   │   ├── layout.tsx              # Root HTML layout with anti-flicker theme loader
│   │   └── page.tsx                # Dashboard entry page
│   ├── components/                 # React components
│   │   ├── Dashboard.tsx           # Main inspector shell, filters, and state coordinator
│   │   ├── MapView.tsx             # Interactive Leaflet map (basemaps, buffers, receptors, vectors)
│   │   ├── AlertCard.tsx           # Kiln cards in review queue with buffer progress
│   │   ├── DetailPanel.tsx         # Slide-out inspector panel with evidence image & stats
│   │   ├── ScannerHud.tsx          # Scan controls, district selector, Run Scan & Stop Scan buttons
│   │   ├── LoginDialog.tsx         # Inspector authentication modal
│   │   └── icons.tsx               # SVG icon library (BrandMark, Sun, Moon, Stop, etc.)
│   ├── lib/                        # API client, TypeScript definitions, and district bounds
│   ├── .env.local                  # Environment configuration
│   └── package.json                # Frontend dependencies (Next.js 16, React 19, Leaflet)
│
├── weights/
│   └── kiln_detector.pt            # Pre-trained YOLOv8 convolutional weights
├── alerts_outbox/                  # Active kiln alert JSON files
│   └── rejected/                   # Archived false alarms flagged by inspectors
├── evidence/                       # High-resolution evidence image crops for active alerts
├── dataset/                        # Active learning datasets
│   ├── confirmed_kilns/            # Verified authentic kiln evidence patches
│   └── false_positives/            # Verified false-positive evidence patches
└── cache/                          # Satellite scene composite cache
```

---

## 🚀 Quickstart: Running Locally

### Step 1: Start the Python FastAPI Backend

Open a terminal in the project root:

```powershell
# Using the existing virtual environment on N: drive:
& "N:\.venv\Scripts\python.exe" web_server.py
```

- The FastAPI backend will start on **`http://127.0.0.1:8000`**.
- Interactive Swagger API documentation is available at **`http://127.0.0.1:8000/docs`**.

---

### Step 2: Start the Next.js Frontend

Open a **second terminal** in the `frontend/` directory:

```powershell
cd "N:\Brick Kiln Watchdog\frontend"

# Install dependencies (if not already installed):
npm install

# Start the Next.js development server:
npm run dev
```

- The Next.js frontend will start on **`http://localhost:3000`**.
- It connects to the FastAPI backend via `frontend/.env.local`.

---

### Step 3: Open the Dashboard

Navigate to:
```
http://localhost:3000
```

- **Theme Toggle**: Click the switch button in the top bar to toggle between dark mode and bluish light mode.
- **District Filter**: Click any district tab (e.g. *Narayanganj*, *Gazipur*) to filter kilns; the active district will be outlined with a box.
- **Run Scan**: Select a district or *All 13 districts* and click **Run Scan**; monitor live progress or click **Stop Scan** to abort.
- **Inspect Kilns**: Click any kiln card or map marker to view satellite evidence, measure buffer distance, and confirm authentic kilns or reject false alarms.
- **Add Kiln**: Click **Add kiln** in the top bar and click anywhere on the map to add a new kiln.

---

## ⚙️ Environment Configuration (`frontend/.env.local`)

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `BACKEND_URL` | `http://127.0.0.1:8000` | URL of the FastAPI backend. If omitted, runs in demo mode. |
| `INSPECTOR_PASSWORD` | `admin` | Password required for Confirm / False alarm / Add kiln mutations. |
| `AUTH_SECRET` | `brick-kiln-watchdog-...` | Secret string used to sign session cookies. |
| `COOKIE_SECURE` | `false` | Set to `false` for local HTTP development. |

---

## 📡 REST API Reference (`http://127.0.0.1:8000`)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `GET /` | `GET` | API landing page (HTML) or backend metadata (JSON). |
| `GET /docs` | `GET` | Interactive Swagger UI API documentation. |
| `GET /api/v1/alerts` | `GET` | Returns list of all active kiln detections sorted by statutory priority tier. |
| `GET /api/v1/system-status` | `GET` | Returns telemetry, data version signature, and aggregate KPI counts. |
| `GET /api/v1/scanner-status` | `GET` | Returns scanner state, current sector, step progress, and estimated time remaining. |
| `GET /api/v1/receptors` | `GET` | Returns GeoJSON FeatureCollection of 3,190+ sensitive receptors. |
| `POST /api/v1/trigger-scan` | `POST` | Triggers an immediate satellite scan for a target sector (`ALL` or specific district). |
| `POST /api/v1/stop-scan` | `POST` | Aborts an in-progress satellite scan and resets the scanning state. |
| `POST /api/v1/kilns/add` | `POST` | Manually registers a kiln by coordinates, reverse-geocodes district, and fetches evidence. |
| `POST /api/v1/kilns/{id}/technology` | `POST` | Updates technology classification (`FCBTK`, `ZIGZAG`, `HOFFMAN_TUNNEL`). |
| `POST /api/v1/kilns/{id}/confirm` | `POST` | Marks detection as human-confirmed and exports evidence to `dataset/confirmed_kilns/`. |
| `POST /api/v1/kilns/{id}/reject` | `POST` | Flags detection as false alarm, adds to spatial blacklist, and moves dossier to `alerts_outbox/rejected/`. |
| `POST /api/v1/purge-bogus` | `POST` | Purges false positive small tin sheds and residential structures from `alerts_outbox/`. |
| `GET /evidence/{filename}` | `GET` | Serves satellite evidence crop images for active detections. |

---

## ⚖️ Statutory Compliance Framework

The platform automates enforcement under the **Brick Manufacturing and Kiln Construction (Control) Act**:

- **1,000-meter Statutory Buffer Zone**:
  - $\text{Distance} < 500\text{m}$: Classified as **CRITICAL VIOLATION** (Immediate regulatory closure tier).
  - $500\text{m} \le \text{Distance} < 1,000\text{m}$: Classified as **HIGH VIOLATION** (Regulatory penalty tier).
  - $\text{Distance} \ge 1,000\text{m}$: Classified as **COMPLIANT** (Safe buffer clearance).
- **Banned Technologies**: Fixed Chimney Bull's Trench Kilns (**FCBTK**) are strictly prohibited nationwide due to excessive particulate matter ($PM_{2.5} / PM_{10}$) emissions.
