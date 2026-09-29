#!/usr/bin/env bash
# Restore a backup into the running stack:  sudo ./deploy/restore.sh deploy/backups/outreach-YYYYMMDD-HHMM.dump
set -euo pipefail
cd "$(dirname "$0")"
file="${1:?usage: restore.sh <path-to-.dump>}"
[ -f "$file" ] || { echo "no such file: $file"; exit 1; }
read -r -p "This REPLACES the current dashboard database with $file. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || exit 1
docker compose stop app worker
docker compose exec -T db sh -c 'dropdb -U outreach --if-exists outreach_restore_old; psql -U outreach -d postgres -c "alter database outreach rename to outreach_restore_old" && createdb -U outreach outreach'
docker compose exec -T db pg_restore -U outreach -d outreach --no-owner < "$file"
docker compose start app worker
echo "Restored. The previous database is kept as outreach_restore_old (drop it once you are happy)."
