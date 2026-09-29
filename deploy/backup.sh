#!/bin/sh
# Nightly pg_dump (custom format) into ./backups, keeping BACKUP_RETENTION_DAYS days.
# Runs inside the postgres:16-alpine "backup" container.
set -eu
mkdir -p /backups
backup() {
  f="/backups/outreach-$(date +%Y%m%d-%H%M).dump"
  if pg_dump -Fc -f "$f.tmp"; then
    mv "$f.tmp" "$f"
    chmod 600 "$f"
    echo "$(date -Iseconds) backup ok: $f ($(du -h "$f" | cut -f1))"
  else
    rm -f "$f.tmp"
    echo "$(date -Iseconds) BACKUP FAILED" >&2
  fi
  find /backups -name 'outreach-*.dump' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
}
# First run: make sure a backup exists soon after deployment.
ls /backups/outreach-*.dump >/dev/null 2>&1 || { sleep 60; backup; }
while true; do
  now=$(date +%s)
  target=$(date -d "$(date +%Y-%m-%d) ${BACKUP_AT:-02:30}" +%s 2>/dev/null || date -D '%Y-%m-%d %H:%M' -d "$(date +%Y-%m-%d) ${BACKUP_AT:-02:30}" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep $((target - now))
  backup
done
