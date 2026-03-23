#!/bin/sh
set -e

# Railway entrypoint script
# Runs as omuser (non-root). Uses passwordless sudo for chown only.
# Uses /app/apps/mercato/storage (mounted volume) for both
# file attachments and the init marker to avoid needing two volumes.

STORAGE_DIR="/app/apps/mercato/storage"
MARKER_FILE="${STORAGE_DIR}/.initialized"

sudo chown -R omuser:omuser "${STORAGE_DIR}"

if [ ! -f "${MARKER_FILE}" ]; then
  echo "First run: full initialization..."
  yarn mercato init
  touch "${MARKER_FILE}"
else
  echo "Subsequent run: running migrations..."
  yarn db:migrate
fi

exec yarn start
