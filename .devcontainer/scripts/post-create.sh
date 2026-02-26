#!/usr/bin/env bash
set -euo pipefail

echo "============================================"
echo "  Open Mercato — Dev Container Setup"
echo "============================================"
echo ""

# --- 0. Fix ownership of named volumes (created as root by Docker) ---
echo "==> [0/7] Fixing volume permissions ..."
for vol_dir in /workspace/node_modules /workspace/apps/mercato/.next /workspace/apps/mercato/storage; do
  if [ -d "$vol_dir" ] && ! sudo chown -R node:node "$vol_dir"; then
    echo "WARNING: Failed to chown $vol_dir — later steps may fail"
  fi
done
for dir in /workspace/packages/*/dist; do
  if [ -d "$dir" ] && ! sudo chown -R node:node "$dir"; then
    echo "WARNING: Failed to chown $dir — package builds may fail"
  fi
done
echo ""

# --- 1. Generate .env ---
echo "==> [1/7] Generating .env from .env.example ..."
bash .devcontainer/scripts/setup-env.sh
echo ""

# --- 2. Install dependencies ---
echo "==> [2/7] Installing dependencies (yarn install) ..."
yarn install
echo ""

# --- 3. Install skills (Claude Code / Codex symlinks) ---
echo "==> [3/7] Installing skills ..."
if [ -f scripts/install-skills.sh ]; then
  bash scripts/install-skills.sh
else
  echo "    (install-skills.sh not found, skipping)"
fi
echo ""

# --- 4. Build packages (first pass) ---
echo "==> [4/7] Building packages (first pass) ..."
yarn build:packages
echo ""

# --- 5. Run generators ---
echo "==> [5/7] Running generators ..."
yarn generate
echo ""

# --- 6. Build packages (second pass — generator output) ---
echo "==> [6/7] Building packages (second pass) ..."
yarn build:packages
echo ""

# --- 7. Database init or migrate ---
# Check actual database state instead of relying on a marker file.
TABLE_COUNT=$(PGPASSWORD=postgres psql -h postgres -U postgres -d open-mercato -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null || echo "0")

if [ "$TABLE_COUNT" -gt "0" ]; then
  echo "==> [7/7] Running database migrations (existing database with $TABLE_COUNT tables) ..."
  (cd apps/mercato && yarn db:migrate)
else
  echo "==> [7/7] Initializing database (first run) ..."
  (cd apps/mercato && yarn mercato init)
fi
echo ""

echo "============================================"
echo "  Setup complete!"
echo ""
echo "  Start developing:  yarn dev"
echo "  App URL:           http://localhost:3000"
echo "  Backend:           http://localhost:3000/backend"
echo "============================================"
