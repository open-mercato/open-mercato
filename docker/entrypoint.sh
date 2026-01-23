#!/bin/bash
# Open Mercato Docker Entrypoint
# Handles first-time initialization and app startup
#
# Environment variables:
#   SKIP_INIT=true        - Skip initialization entirely (for pre-initialized DBs)
#   FORCE_INIT=true       - Force re-initialization (ignores marker)
#   INIT_FLAGS="--no-examples"  - Flags to pass to yarn initialize

set -e

# Marker file location - use mounted volume if available, otherwise local
INIT_MARKER="${INIT_MARKER_PATH:-/app/.initialized_data/.initialized}"

# Ensure marker directory exists
mkdir -p "$(dirname "$INIT_MARKER")" 2>/dev/null || true

echo "[Open Mercato] Starting..."

# Skip initialization if explicitly requested
if [ "${SKIP_INIT:-false}" = "true" ]; then
  echo "[Open Mercato] SKIP_INIT=true, skipping all initialization."
else
  # Determine if initialization is needed
  NEEDS_INIT=false
  
  if [ "${FORCE_INIT:-false}" = "true" ]; then
    echo "[Open Mercato] FORCE_INIT=true, forcing initialization..."
    NEEDS_INIT=true
  elif [ ! -f "$INIT_MARKER" ]; then
    echo "[Open Mercato] First run detected (no marker file)..."
    NEEDS_INIT=true
  fi
  
  if [ "$NEEDS_INIT" = "true" ]; then
    # Run database migrations
    echo "[Open Mercato] Running database migrations..."
    yarn db:migrate
    
    # Initialize the application (seeds, default data, etc.)
    echo "[Open Mercato] Running yarn initialize ${INIT_FLAGS:-}..."
    yarn initialize ${INIT_FLAGS:-}
    
    # Create marker to prevent re-initialization
    touch "$INIT_MARKER"
    echo "[Open Mercato] Initialization complete!"
  else
    echo "[Open Mercato] Already initialized, skipping setup."
    
    # Still run migrations in case there are new ones
    echo "[Open Mercato] Checking for pending migrations..."
    yarn db:migrate || echo "[Open Mercato] No pending migrations or migration check skipped."
  fi
fi

# Start the application
echo "[Open Mercato] Starting server..."
exec "$@"
