#!/bin/sh

# Ensure node_modules volume has all workspace symlinks (handles new packages added after volume creation)
cd /app

if [ -f /tmp/docker-exec-skip-rebuilt.skip ]; then
  echo "Skipping rebuild for this restart..."
  rm -f /tmp/docker-exec-skip-rebuilt.skip
  exec yarn dev
fi

# Seed the named volumes from the prebuilt image artifacts (/opt/prebuilt,
# baked by the Dockerfile dev-build stage at native VM speed). This replaces
# the slow first-boot install/build over the Windows bind mount with a plain
# file copy. Everything is guarded: when the prebuilt artifacts are missing
# (older image) or stale (yarn.lock changed since the image was built), the
# normal install/build below simply does the full work.
seed_prebuilt() {
  PREBUILT=/opt/prebuilt
  [ -d "$PREBUILT/node_modules" ] || return 0
  if ! cmp -s /app/yarn.lock "$PREBUILT/yarn.lock"; then
    echo "[app] Prebuilt image artifacts are stale (yarn.lock changed) - running the full install instead. Rebuild the image to re-enable fast boots: powershell starters\docker\windows\start-dev.ps1 -Rebuild"
    return 0
  fi
  if [ ! -f /app/node_modules/.prebuilt-seeded ]; then
    echo "[app] Seeding node_modules from the prebuilt image (much faster than installing over the bind mount)..."
    cp -a "$PREBUILT/node_modules/." /app/node_modules/ || return 0
    date > /app/node_modules/.prebuilt-seeded
  fi
  for pkg in core shared ui cli cache content checkout events onboarding queue search scheduler ai-assistant create-app; do
    src="$PREBUILT/dist/$pkg"
    dst="/app/packages/$pkg/dist"
    if [ -d "$src" ] && [ -z "$(ls -A "$dst" 2>/dev/null)" ]; then
      mkdir -p "$dst"
      cp -a "$src/." "$dst/" || true
    fi
  done
}
seed_prebuilt

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
