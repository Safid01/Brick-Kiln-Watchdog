# Brick Kiln Watchdog — Next.js Dashboard

Inspector dashboard for the brick-kiln detection platform (YOLOv8 + 1 km school/hospital buffer check).
The web app is built with Next.js 16 (App Router, Turbopack, TypeScript, Leaflet). Inference and geospatial calculations run in the Python/FastAPI backend (`web_server.py`); Next.js communicates with it through server-side proxy routes.

```
Browser ──► Next.js (this repo) ──► FastAPI backend (YOLO, geopandas, alerts_outbox/)
              │  /api/v1/*   allow-listed proxy + login-gated mutations
              │  /evidence/* evidence crops (from backend, or bundled demo)
              └─ no BACKEND_URL → DEMO mode: bundled alerts + receptors snapshot
```

## Running the Frontend

```bash
npm install
npm run dev                    # http://localhost:3000
```

| Variable | Purpose |
| --- | --- |
| `BACKEND_URL` | FastAPI base URL (e.g. `http://127.0.0.1:8000`). Empty = demo mode. |
| `INSPECTOR_PASSWORD` | Password for Confirm / False alarm / Add kiln / Run scan. Default: `admin`. |
| `AUTH_SECRET` | 32+ random characters; signs the session cookie. |
| `COOKIE_SECURE` | Set to `false` for local HTTP development. |

## Implemented Features

- **Dual Theme System**: Seamless toggle between dark mode and a bluish-toned light mode (frosty ice-blue and sky-slate surfaces, no plain white).
- **Interactive GIS Map**: Esri World Imagery (Satellite) and Street basemaps, 1 km statutory buffer rings, 3,190+ sensitive receptors GeoJSON overlay, and vector proximity lines.
- **Top Summary KPIs**: Total Mapped kilns, Situations (`#E11A45` in both modes), and Buffer Breaches (`#FFCD54` in dark mode, `#ea580c` in light mode).
- **District Navigation Bar**: All 13 districts of Greater Dhaka Division plus an *All* tab; active district highlighted with a boxed border; horizontal scrolling via left/right chevrons, mouse wheel, or scrollbar.
- **Scanner HUD & Live Progress**: District target selector, `Run Scan` button, `Stop Scan` button (`IconStop`), and real-time progress banner with animated progress bar, sector counter, and live ETA.
- **Review Queue Sidebar**: Triage filters (`Situations`, `Critical`, `High`, `Safe`, `FCBTK`, `All kilns`), audited kiln counters, cards with prominent Kiln ID and District badge, distance progress bars, technology badges, and active learning actions (`Confirm`, `False alarm`, `Trace`).
- **Interactive Kiln Placement**: `+ Add kiln` mode with crosshair map cursor, floating status pill, and modal with automated reverse-geocoding.
- **Detail Panel**: High-resolution evidence satellite crop, physical dimensions ($L \times W \times \text{Area}$), nearest receptor distance, and technology selector dropdown.
- **Polling & Caching**: Polls `/api/v1/system-status` every 3 seconds, fetching updated alert payloads only when `data_version` changes.
