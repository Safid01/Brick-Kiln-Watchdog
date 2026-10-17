# Brick Kiln Watchdog — Next.js dashboard

Inspector dashboard for the brick-kiln detection pipeline (YOLOv8 + 1 km school/hospital buffer check).
The web app is Next.js (App Router, TypeScript, Leaflet). Detection, scanning and OSM sync stay in the
Python/FastAPI backend (`web_server.py`); Next.js talks to it through a server-side proxy.

```
Browser ──► Next.js (this repo) ──► FastAPI backend (YOLO, geopandas, alerts_outbox/)
              │  /api/v1/*   allow-listed proxy + login-gated mutations
              │  /evidence/* evidence crops (from backend, or bundled demo)
              └─ no BACKEND_URL → DEMO mode: bundled 168 alerts + 3,191 receptors
```

## Run

```bash
npm install
cp .env.example .env.local     # then edit values
npm run dev                    # http://localhost:3000
```

| Variable | Purpose |
| --- | --- |
| `BACKEND_URL` | FastAPI base URL. **Empty = demo mode** (read-only snapshot, no live scans). |
| `INSPECTOR_PASSWORD` | Password for Confirm / False alarm / Trigger scan / Pause. Empty = those actions are disabled. |
| `AUTH_SECRET` | 32+ random chars; signs the session cookie. |

Live mode: run the Python backend (`python web_server.py`), set `BACKEND_URL=http://127.0.0.1:8000`, restart Next.js.
`BACKEND_URL` is read at runtime, no rebuild needed.

## What it does

- Map (Esri satellite / street / OSM) with **all** kilns, colored by buffer tier; purple outline = FCBTK, dashed halo = plume signal.
- Sidebar queue with only the kilns that need attention (breach, plume signal, or FCBTK), region tabs, filters, search.
- Click a kiln → flies to it, draws the line to the nearest school/hospital with the distance, opens the detail panel.
- Optional layers: 1 km buffer rings, 3,191 schools & hospitals (loaded on first toggle).
- Scanner HUD: last audit, scheduler state/countdown, pause/resume, on-demand scan (live mode only).
- Polls `/system-status` every 3 s and re-fetches alerts only when `data_version` changes.

## Security notes

- The browser never talks to FastAPI directly; only a fixed allow-list of endpoints is proxied, kiln IDs and scan targets are validated.
- All POSTs need a signed inspector cookie (HttpOnly, SameSite=Strict) **and** an `x-bk-csrf` header. Login is rate-limited per IP.
- OSM facility names are untrusted: they are rendered as text nodes / React text, never as HTML.
- Keep the FastAPI backend on a private network or `127.0.0.1` (it has no auth of its own); only Next.js should reach it.
- In demo mode, confirm/reject live in server memory only and reset on restart.

## Deploy

- **Next.js**: Vercel / any Node host (`npm run build && npm start`). Set the three env vars.
- **Python backend**: needs a long-running process and a persistent disk (`alerts_outbox/`, `evidence/`, `weights/`), so a VM / Railway / Fly.io, not serverless.

## Known limitations (backend side, not fixed here)

These come from the current Python pipeline and affect what the dashboard shows:
kiln IDs are per-run indexes (re-scans can overwrite human verification), Nawabganj is silently scanned at zoom 15
(306 tiles > 300 cap), sector overlap creates duplicate kilns, and the plume / technology labels are heuristics on a
single static image, with no published accuracy numbers. Treat every detection as a candidate for human verification.
