#!/usr/bin/env bash
set -euo pipefail

ENV_EXAMPLE="apps/mercato/.env.example"
ENV_FILE="apps/mercato/.env"

echo "==> Generating $ENV_FILE from $ENV_EXAMPLE"

if [ ! -f "$ENV_EXAMPLE" ]; then
  echo "ERROR: $ENV_EXAMPLE not found. Are you in the project root?"
  exit 1
fi

cp "$ENV_EXAMPLE" "$ENV_FILE"

# --- Rewrite hostnames for container networking ---

# Database: localhost → postgres
# Note: DATABASE_URL is also set in docker-compose.yml (takes precedence at runtime).
# We rewrite .env too so the file looks correct if inspected directly.
sed -i 's|@localhost:5432|@postgres:5432|g' "$ENV_FILE"

# Redis: uncomment and point to container
sed -i 's|^# REDIS_URL=redis://localhost:6379|REDIS_URL=redis://redis:6379|' "$ENV_FILE"
sed -i 's|^# EVENTS_REDIS_URL=redis://localhost:6379|EVENTS_REDIS_URL=redis://redis:6379|' "$ENV_FILE"

# Meilisearch: uncomment and point to container
sed -i 's|^# MEILISEARCH_HOST=http://localhost:7700|MEILISEARCH_HOST=http://meilisearch:7700|' "$ENV_FILE"
sed -i 's|^# MEILISEARCH_API_KEY=your_master_key_here|MEILISEARCH_API_KEY=meilisearch-dev-key|' "$ENV_FILE"

# Cache: switch to redis strategy
sed -i 's|^CACHE_STRATEGY=sqlite|CACHE_STRATEGY=redis|' "$ENV_FILE"
sed -i 's|^#CACHE_REDIS_URL=redis://localhost:6379|CACHE_REDIS_URL=redis://redis:6379|' "$ENV_FILE"

# Redis port (uncomment)
sed -i 's|^#REDIS_PORT=6379|REDIS_PORT=6379|' "$ENV_FILE"

# Vault: point to host machine (Docker Desktop) so Vault on host is reachable
sed -i 's|VAULT_ADDR=http://localhost:8200|VAULT_ADDR=http://host.docker.internal:8200|' "$ENV_FILE"

# JWT: ensure a dev secret is set
sed -i 's|^JWT_SECRET=change-me-dev-secret|JWT_SECRET=devcontainer-jwt-secret-do-not-use-in-prod|' "$ENV_FILE"

# --- Verify critical rewrites were applied ---
# The sed patterns above are tightly coupled to .env.example format.
# If .env.example changes comment style or whitespace, these checks catch silent failures.
errors=0
if ! grep -q 'postgres:5432' "$ENV_FILE"; then
  echo "WARNING: DATABASE_URL was not rewritten to use postgres:5432"
  errors=$((errors + 1))
fi
if ! grep -q 'REDIS_URL=redis://redis:6379' "$ENV_FILE"; then
  echo "WARNING: REDIS_URL was not rewritten to use redis:6379"
  errors=$((errors + 1))
fi
if ! grep -q 'MEILISEARCH_HOST=http://meilisearch:7700' "$ENV_FILE"; then
  echo "WARNING: MEILISEARCH_HOST was not rewritten to use meilisearch:7700"
  errors=$((errors + 1))
fi
if [ $errors -gt 0 ]; then
  echo "WARNING: $errors env rewrite(s) failed — .env.example format may have changed."
  echo "         Check .devcontainer/scripts/setup-env.sh sed patterns."
fi

echo "==> $ENV_FILE generated successfully."
echo ""
echo "    To override any value, create apps/mercato/.env.local"
echo "    (.env.local takes priority — Next.js native behavior)"
echo "    Do NOT edit .env directly — it is regenerated on container rebuild."
