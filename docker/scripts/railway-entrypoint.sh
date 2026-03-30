#!/bin/sh
set -e

# Railway entrypoint script
# Runs as omuser (non-root). Uses passwordless sudo for chown only.
# Uses /app/apps/mercato/storage (mounted volume) for both
# file attachments and the init marker to avoid needing two volumes.

STORAGE_DIR="/app/apps/mercato/storage"
MARKER_FILE="${STORAGE_DIR}/.initialized"

sudo chown -R omuser:omuser "${STORAGE_DIR}"
INIT_MARKER_FILE="${MARKER_FILE}" INIT_COMMAND="yarn mercato init" sh /app/docker/scripts/init-or-migrate.sh

exec yarn start
