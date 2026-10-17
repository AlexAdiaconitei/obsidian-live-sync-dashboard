#!/bin/sh
set -eu
: "${COUCHDB_URL:?Set COUCHDB_URL}"
set -- node --permission \
  --allow-fs-read=/app/build \
  --allow-fs-read=/app/node_modules \
  --allow-fs-read=/app/package.json \
  --allow-fs-read=/app/dist \
  --allow-fs-read=/backup/status \
  --allow-fs-read=/backup/requests \
  --allow-fs-write=/backup/requests
if [ -n "${GOOGLE_DRIVE_CLIENT_ID:-}" ]; then
  set -- "$@" --allow-child-process \
    --allow-fs-read="${PERSONAL_BACKUP_WORK_DIR:-/tmp}" \
    --allow-fs-write="${PERSONAL_BACKUP_WORK_DIR:-/tmp}"
fi
exec "$@" build/src/main.js
