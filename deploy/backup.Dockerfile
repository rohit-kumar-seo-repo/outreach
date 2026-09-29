# Nightly pg_dump sidecar (see backup.sh). Built from the same repository as the app.
FROM postgres:16-alpine
COPY deploy/backup.sh /backup.sh
ENTRYPOINT ["/bin/sh", "/backup.sh"]
