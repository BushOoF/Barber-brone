#!/bin/sh
set -e

# Sync the Postgres schema to prisma/schema.prisma. We use `db push` because
# this reference project ships the schema (not a committed migration history).
# For a real production rollout, generate migrations and switch this to
# `npx prisma migrate deploy` instead (see README).
echo "[entrypoint] applying database schema (prisma db push)…"
npx --no-install prisma db push --skip-generate

# Seed the admin barber(s) from ADMIN_TELEGRAM_IDS. Idempotent (upsert).
# The seed is compiled to dist/seed.js during the image build, so no tsx needed.
echo "[entrypoint] seeding admin barbers…"
node dist/seed.js || echo "[entrypoint] seed skipped/failed (continuing)"

echo "[entrypoint] starting: $*"
exec "$@"
