#!/bin/sh

# Ensure node_modules volume has all workspace symlinks (handles new packages added after volume creation)
cd /app

if [ -f /tmp/docker-exec-skip-rebuilt.skip ]; then
  echo "Skipping rebuild for this restart..."
  rm -f /tmp/docker-exec-skip-rebuilt.skip
  exec yarn dev
fi

# The setup phase (install -> build -> generate -> init/migrate) is expensive
# (minutes). When it fails and the container exits, `restart: unless-stopped`
# re-runs the whole thing at most every ~1 minute FOREVER — an expensive
# crash-restart churn. Run it via an explicit guard instead: on failure, print
# an actionable banner and pause before exiting so the loop is visibly paced,
# transient causes (database briefly unavailable) can self-heal, and the error
# stays readable at the end of `docker compose logs app`.
run_setup() {
  set -e
  yarn install

  # Build packages, then generate (writes packages/core/generated/), then rebuild so core gets dist/generated/
  yarn build:packages
  yarn generate
  yarn build:packages

  cd /app/apps/mercato
  INIT_COMMAND="yarn mercato init" sh /app/docker/scripts/init-or-migrate.sh
  cd /app
}

if ! (run_setup); then
  echo "==============================================================" >&2
  echo "[app] SETUP FAILED (see the error above). Common causes:" >&2
  echo "[app]   - a dependency install / package build error" >&2
  echo "[app]   - the database rejected init/migration (check .env credentials)" >&2
  echo "[app] Pausing 60s before the container restarts and retries," >&2
  echo "[app] so this does not become a tight rebuild loop." >&2
  echo "==============================================================" >&2
  sleep 60
  exit 1
fi

exec yarn dev
