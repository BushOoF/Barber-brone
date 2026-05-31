#!/usr/bin/env bash
#
# Project 1 (monolithic) — idempotent setup.
#
# Builds all images, applies DB migrations, seeds the admin barber(s), and
# brings the whole stack up. Safe to run repeatedly:
#   - migrate deploy only applies pending migrations
#   - the seed upserts by Telegram ID
#
# Usage:  ./setup.sh
#
set -euo pipefail

cd "$(dirname "$0")"

# --- 0. Pick the compose command (v2 plugin preferred, v1 fallback). ---
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "ERROR: Docker Compose not found. Install Docker Desktop or the compose plugin." >&2
  exit 1
fi

# --- 1. Ensure a .env exists (compose reads it for tokens/secrets). ---
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "No .env found — copying .env.example to .env."
    cp .env.example .env
    echo ">> Edit .env now and set TELEGRAM_BOT_TOKEN and ADMIN_TELEGRAM_IDS, then re-run ./setup.sh." >&2
    exit 1
  else
    echo "ERROR: no .env and no .env.example to copy from." >&2
    exit 1
  fi
fi

# --- 2. Build images. ---
echo "==> Building images…"
$COMPOSE build

# --- 3. Start Postgres and wait until it is healthy. ---
echo "==> Starting Postgres…"
$COMPOSE up -d postgres

echo "==> Waiting for Postgres to become healthy…"
until [ "$($COMPOSE ps -q postgres | xargs -r docker inspect -f '{{.State.Health.Status}}' 2>/dev/null || echo starting)" = "healthy" ]; do
  printf '.'
  sleep 2
done
echo " ok"

# --- 4. Apply migrations + seed via a one-off bot container. ---
# (The long-running bot container also does this on boot; doing it here makes
#  the DB ready before anything starts polling and surfaces errors early.)
echo "==> Applying migrations…"
$COMPOSE run --rm --no-deps --entrypoint "npx prisma migrate deploy" bot

echo "==> Seeding admin barber(s)…"
$COMPOSE run --rm --no-deps --entrypoint "npx tsx prisma/seed.ts" bot

# --- 5. Bring everything up. ---
echo "==> Starting the full stack (bot, ai, ollama)…"
$COMPOSE up -d

echo
echo "Done. Useful next steps:"
echo "  - If using the bundled Ollama, pull the model once:"
echo "      $COMPOSE exec ollama ollama pull gemma4:e4b"
echo "  - Tail logs:"
echo "      $COMPOSE logs -f bot ai"
