#!/usr/bin/env bash
# One-shot setup for Ubuntu 22.04/24.04 (EC2). Run as the normal user (ubuntu), NOT as root:
#
#   INSPECTOR_PASSWORD='a-strong-password' ./deploy.sh [your-domain.com]
#
# Expects these two folders next to each other in $HOME (change the vars below if different):
#   ~/brick-kiln-detection-main   (Python backend: web_server.py, weights/, ...)
#   ~/brick-kiln-web              (this Next.js app)
#
# Safe to re-run: it rebuilds the app and restarts the services.
set -euo pipefail

DOMAIN="${1:-}"
APP_USER="$(id -un)"
BACKEND_DIR="${BACKEND_DIR:-$HOME/brick-kiln-detection-main}"
WEB_DIR="${WEB_DIR:-$HOME/brick-kiln-web}"

[ "$(id -u)" -ne 0 ] || { echo "Run as a normal user with sudo, not as root."; exit 1; }
[ -f "$BACKEND_DIR/web_server.py" ] || { echo "Backend not found at $BACKEND_DIR"; exit 1; }
[ -f "$WEB_DIR/package.json" ]      || { echo "Web app not found at $WEB_DIR"; exit 1; }

echo "==> 1/6 System packages"
sudo apt-get update -y
sudo apt-get install -y python3-venv python3-pip git curl unzip debian-keyring debian-archive-keyring apt-transport-https gpg

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

echo "==> 2/6 Python backend (CPU-only torch, the server has no GPU)"
cd "$BACKEND_DIR"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -r requirements.txt

echo "==> 3/6 Web app config"
cd "$WEB_DIR"
if [ ! -f .env.local ]; then
  : "${INSPECTOR_PASSWORD:?Set INSPECTOR_PASSWORD='...' when running this script the first time}"
  {
    echo "BACKEND_URL=http://127.0.0.1:8000"
    echo "INSPECTOR_PASSWORD=${INSPECTOR_PASSWORD}"
    echo "AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    # No domain => plain HTTP => browsers reject Secure cookies, so login would silently fail.
    [ -n "$DOMAIN" ] || echo "COOKIE_SECURE=false"
  } > .env.local
  chmod 600 .env.local
  echo "    wrote .env.local"
else
  echo "    .env.local already exists, leaving it alone"
fi

echo "==> 4/6 Build web app"
npm install --no-audit --no-fund
npm run build

echo "==> 5/6 systemd services"
sed -e "s|__USER__|$APP_USER|g" -e "s|__DIR__|$BACKEND_DIR|g" "$WEB_DIR/deploy/kiln-backend.service" | sudo tee /etc/systemd/system/kiln-backend.service >/dev/null
sed -e "s|__USER__|$APP_USER|g" -e "s|__DIR__|$WEB_DIR|g"     "$WEB_DIR/deploy/kiln-web.service"     | sudo tee /etc/systemd/system/kiln-web.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable kiln-backend kiln-web
sudo systemctl restart kiln-backend
sleep 3
sudo systemctl restart kiln-web

echo "==> 6/6 Caddy (reverse proxy${DOMAIN:+ + HTTPS for $DOMAIN})"
if [ -n "$DOMAIN" ]; then
  sed "s|__DOMAIN__|$DOMAIN|g" "$WEB_DIR/deploy/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
else
  sed "s|__DOMAIN__|:80|g" "$WEB_DIR/deploy/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
fi
sudo systemctl reload caddy || sudo systemctl restart caddy

echo
echo "Done. Quick checks:"
echo "  systemctl status kiln-backend kiln-web --no-pager"
echo "  curl -s http://127.0.0.1:8000/api/v1/system-status | head -c 200"
if [ -n "$DOMAIN" ]; then echo "  open https://$DOMAIN"; else echo "  open http://<your-elastic-ip>   (HTTP only, add a domain for HTTPS)"; fi
echo
echo "IMPORTANT: the backend auto-scans every 120s and can overwrite inspector confirmations."
echo "Log in and press 'Pause' on the auto-sweep until the kiln-ID issue in the backend is fixed."
