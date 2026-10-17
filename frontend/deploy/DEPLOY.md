# Live deploy on AWS EC2 (one server runs both parts)

```
Internet ─► Caddy :80/:443 ─► Next.js 127.0.0.1:3000 ─► FastAPI 127.0.0.1:8000
```
Only Caddy is public. The Python backend has no login, so it must never be reachable from outside.

## 1. Launch the instance (AWS console)
- AMI: **Ubuntu 24.04 LTS**, type **t3.medium** or bigger (4 GB RAM; torch + ultralytics + geopandas need it), **30 GB** gp3 disk.
- Security group inbound: **22 from My IP only**, **80** and **443** from anywhere. Do not open 3000 or 8000.
- Allocate an **Elastic IP** and attach it. Optional but recommended: point a domain A record at it.
- AWS Billing → create a **Budget alert**.

## 2. Upload the two folders
From your Windows PC (PowerShell), with your key file:
```powershell
scp -i key.pem -r C:\path\brick-kiln-detection-main ubuntu@<ELASTIC-IP>:~/
scp -i key.pem -r C:\path\brick-kiln-web           ubuntu@<ELASTIC-IP>:~/
```
Do **not** upload `node_modules/` or `.next/` (delete them first, or zip without them), and do not copy your local `.env.local`.
Upload the backend's `weights/kiln_detector.pt` too (it is inside the folder).

## 3. Run the setup script
```bash
ssh -i key.pem ubuntu@<ELASTIC-IP>
cd ~/brick-kiln-web/deploy && chmod +x deploy.sh

# with a domain (HTTPS automatic):
INSPECTOR_PASSWORD='choose-a-strong-one' ./deploy.sh yourdomain.com
# no domain yet (HTTP only, test only):
INSPECTOR_PASSWORD='choose-a-strong-one' ./deploy.sh
```
First run takes several minutes (torch download + build).

## 4. Check
```bash
systemctl status kiln-backend kiln-web --no-pager
curl -s http://127.0.0.1:8000/api/v1/system-status | head -c 300
journalctl -u kiln-backend -f      # backend logs
journalctl -u kiln-web -f          # web logs
```
Open the site: the top pill should say **LIVE**.

## 5. Do this right after the first login
The backend starts auto-scanning every 120 s. Each re-scan rewrites `alerts_outbox/*.json` with per-run IDs, which can
**wipe inspector confirmations and bring back rejected false alarms**. Until the backend ID issue is fixed, click
**Pause** in the dashboard, and trigger scans manually only when you want a fresh baseline.

## Updating later
```bash
cd ~/brick-kiln-web && git pull   # or re-upload files
cd deploy && ./deploy.sh          # rebuilds and restarts (keeps .env.local)
```

## Backups
Everything the app learns lives on the disk: `alerts_outbox/`, `evidence/`, `dataset/`. Enable EBS snapshots
(AWS Backup / Data Lifecycle Manager), otherwise terminating the instance loses it all.

## Troubleshooting
| Symptom | Fix |
| --- | --- |
| Red banner "Backend unreachable" | `systemctl status kiln-backend`, then `journalctl -u kiln-backend -n 50` |
| Login does nothing on `http://<ip>` | `.env.local` needs `COOKIE_SECURE=false` (deploy.sh adds it when no domain). Better: use a domain + HTTPS |
| `pip install` killed / out of memory | Use a bigger instance, or add swap: `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |
| Caddy cannot get a certificate | Domain A record must point to the Elastic IP, and ports 80/443 must be open |
| Changed `.env.local` | `sudo systemctl restart kiln-web` |
