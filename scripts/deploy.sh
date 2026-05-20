#!/usr/bin/env bash
# deploy.sh — pull latest main, build, migrate, reload. Run on the VPS.
#
# Assumes:
#   - Code lives at /srv/Barber-brone
#   - Webapp static files served from /var/www/barber-webapp
#   - Backend managed by PM2 process name "barber-backend"
#
# Override paths with env vars: BARBER_REPO_DIR=/opt/foo ./deploy.sh

set -euo pipefail

REPO="${BARBER_REPO_DIR:-/srv/Barber-brone}"
WEBROOT="${BARBER_WEBROOT:-/var/www/barber-webapp}"
PM2_APP="${BARBER_PM2_APP:-barber-backend}"

cd "$REPO"

echo "[deploy] pulling latest main"
git fetch origin
git checkout main
git pull --ff-only origin main

echo "[deploy] npm ci (workspaces)"
npm ci

echo "[deploy] applying database migrations"
npm --workspace apps/backend exec -- prisma migrate deploy

echo "[deploy] building backend + webapp"
npm --workspace apps/backend run build
npm --workspace apps/webapp run build

echo "[deploy] publishing static assets to $WEBROOT"
sudo mkdir -p "$WEBROOT"
sudo rsync -a --delete apps/webapp/dist/ "$WEBROOT/"

echo "[deploy] reloading $PM2_APP (zero-downtime)"
pm2 reload "$PM2_APP"

echo "[deploy] done. Tail logs with: pm2 logs $PM2_APP"
