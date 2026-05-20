#!/usr/bin/env bash
# barber-backup.sh — daily Postgres backup, keep 14 most recent.
#
# Install on a Lightsail/VPS host:
#   sudo cp scripts/backup-db.sh /usr/local/bin/barber-backup.sh
#   sudo chmod +x /usr/local/bin/barber-backup.sh
#   sudo crontab -e
#     30 3 * * * /usr/local/bin/barber-backup.sh
#
# Test:
#   sudo /usr/local/bin/barber-backup.sh && ls -lh /var/backups/barber/
#
# Optional: push off-site afterwards (uncomment + configure):
#   aws s3 cp "$OUT" s3://your-bucket/barber-brone/

set -euo pipefail

CONTAINER="${BARBER_PG_CONTAINER:-barber-brone-postgres}"
USER="${BARBER_PG_USER:-barber}"
DEST="${BARBER_BACKUP_DIR:-/var/backups/barber}"
RETAIN_DAYS="${BARBER_BACKUP_RETAIN_DAYS:-14}"

mkdir -p "$DEST"
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DEST/all_${TS}.sql.gz"

echo "[barber-backup] dumping $CONTAINER -> $OUT"
docker exec "$CONTAINER" pg_dumpall -U "$USER" | gzip > "$OUT"

# Prune old backups
echo "[barber-backup] pruning >${RETAIN_DAYS}-day files in $DEST"
find "$DEST" -name 'all_*.sql.gz' -mtime "+${RETAIN_DAYS}" -delete

echo "[barber-backup] done ($(du -h "$OUT" | cut -f1))"
