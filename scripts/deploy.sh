#!/usr/bin/env bash
# deploy.sh — pull latest main, build all workspaces, run migrations on both
# databases, and reload PM2. Designed to be run on the VPS.
#
# Assumes:
#   - Code lives at /srv/Barber-brone (override with BARBER_REPO_DIR)
#   - Webapp static files served from /var/www/barber-webapp (override with BARBER_WEBROOT)
#   - PM2 processes named "barber-backend" and "barber-operator"
#
# Usage:
#   sudo -u barber bash /srv/Barber-brone/scripts/deploy.sh
#
# Environment knobs:
#   BARBER_REPO_DIR    — repo path (default /srv/Barber-brone)
#   BARBER_WEBROOT     — nginx web root (default /var/www/barber-webapp)
#   PM2_BACKEND_APP    — shop bot PM2 name (default barber-backend)
#   PM2_OPERATOR_APP   — operator bot PM2 name (default barber-operator)
#   SKIP_OPERATOR=1    — only deploy the shop bot
#   SKIP_BACKEND=1     — only deploy the operator bot

set -euo pipefail

REPO="${BARBER_REPO_DIR:-/srv/Barber-brone}"
WEBROOT="${BARBER_WEBROOT:-/var/www/barber-webapp}"
PM2_BACKEND_APP="${PM2_BACKEND_APP:-barber-backend}"
PM2_OPERATOR_APP="${PM2_OPERATOR_APP:-barber-operator}"

cd "$REPO"

echo "[deploy] pulling latest main"
git fetch origin
git checkout main
git pull --ff-only origin main

echo "[deploy] npm ci (all workspaces)"
npm ci

# ----- Shop bot (backend + webapp) -----
if [[ "${SKIP_BACKEND:-0}" != "1" ]]; then
  echo "[deploy] backend: prisma migrate deploy"
  npm --workspace apps/backend exec -- prisma migrate deploy

  echo "[deploy] backend: build"
  npm --workspace apps/backend run build

  echo "[deploy] webapp: build"
  npm --workspace apps/webapp run build

  echo "[deploy] publishing static assets to $WEBROOT"
  sudo mkdir -p "$WEBROOT"
  sudo rsync -a --delete apps/webapp/dist/ "$WEBROOT/"

  echo "[deploy] reloading $PM2_BACKEND_APP (zero-downtime)"
  pm2 reload "$PM2_BACKEND_APP" || pm2 start ecosystem.config.js --only "$PM2_BACKEND_APP"
fi

# ----- Operator bot (control plane) -----
if [[ "${SKIP_OPERATOR:-0}" != "1" ]]; then
  echo "[deploy] operator: prisma migrate deploy"
  npm --workspace apps/barber-dev exec -- prisma migrate deploy

  echo "[deploy] operator: build"
  npm --workspace apps/barber-dev run build

  echo "[deploy] reloading $PM2_OPERATOR_APP (zero-downtime)"
  pm2 reload "$PM2_OPERATOR_APP" || pm2 start ecosystem.config.js --only "$PM2_OPERATOR_APP"
fi

echo "[deploy] done. Tail logs with:"
echo "  pm2 logs $PM2_BACKEND_APP"
echo "  pm2 logs $PM2_OPERATOR_APP"
