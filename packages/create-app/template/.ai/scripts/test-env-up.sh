#!/bin/sh
# om-prepare-test-env: generated entrypoint (contract v2)
# regenerate with: om-prepare-test-env --regenerate
# history:
#   shipped by create-mercato-app (discovered mode: wraps `mercato test:ephemeral`, the
#   standalone app's own ephemeral runner — build cache, DB provisioning, seeding, and
#   locking built in; cold boot takes minutes, warm reuse seconds)
set -eu

# --- project-specific parameters ------------------------------------------
UP_COMMAND="yarn test:integration:ephemeral:start"   # app's own ephemeral boot (mercato test:ephemeral)
PREFERRED_PORT=5001
STATE_FILE=".ai/qa/ephemeral-env.json"               # written by the mercato CLI, authoritative for its own reuse decisions
QA_DIR=".ai/qa"
ENV_DESCRIPTOR="$QA_DIR/test-env.json"
LOCK_DIR="$QA_DIR/test-env.lock"
BOOT_LOG="$QA_DIR/test-env-boot.log"
ADMIN_EMAIL="admin@acme.com"
ADMIN_PASSWORD="secret"
TTL="${TEST_ENV_CACHE_TTL_SECONDS:-600}"
# The mercato CLI gates its own reuse on this env var; keep the two TTLs in lockstep.
export OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS="${OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS:-$TTL}"
export OM_INTEGRATION_APP_READY_TIMEOUT_SECONDS="${OM_INTEGRATION_APP_READY_TIMEOUT_SECONDS:-180}"

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force|--force-rebuild) FORCE=1 ;;
  esac
done

say() { printf '%s\n' "$*"; }

probe() { # probe <baseUrl> -> 0 when shell + authenticated round trip pass
  base="$1"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$base/login" || echo 000)
  [ "$code" = "200" ] || return 1
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$base/api/auth/login" \
    -d "email=$ADMIN_EMAIL" -d "password=$ADMIN_PASSWORD" -c /dev/null || echo 000)
  [ "$code" = "200" ] || return 1
  return 0
}

write_descriptor() { # write_descriptor <baseUrl> <appPid> <reused>
  base="$1"; app_pid="$2"; reused="$3"
  db_url=$(sed -n 's/.*"databaseUrl": *"\([^"]*\)".*/\1/p' "$STATE_FILE" 2>/dev/null | head -1)
  started=$(sed -n 's/.*"startedAt": *"\([^"]*\)".*/\1/p' "$STATE_FILE" 2>/dev/null | head -1)
  cat > "$ENV_DESCRIPTOR" <<EOF
{
  "version": 1,
  "runId": "$(date -u +%Y%m%d%H%M%S)-ephemeral",
  "status": "running",
  "mode": "discovered",
  "baseUrl": "$base",
  "startedByThisRepo": true,
  "startScript": ".ai/scripts/test-env-up.sh",
  "stopScript": ".ai/scripts/test-env-down.sh",
  "app": { "startCommand": "$UP_COMMAND", "port": ${base##*:}, "healthPath": "/login", "pid": ${app_pid:-null} },
  "services": [
    { "type": "postgres", "url": "${db_url:-}", "env": { "DATABASE_URL": "${db_url:-}" } }
  ],
  "credentials": [
    { "role": "admin", "username": "admin@acme.com", "password": "secret" },
    { "role": "employee", "username": "employee@acme.com", "password": "secret" }
  ],
  "playwright": { "runner": "playwright", "installed": true, "config": ".ai/qa/tests/playwright.config.ts", "browsers": ["chromium"] },
  "platform": "$(uname -s | tr '[:upper:]' '[:lower:]')",
  "startedAt": "${started:-$(date -u +%FT%TZ)}",
  "notes": "Discovered mode: the mercato CLI owns build cache/reuse/locking ($STATE_FILE is authoritative). Suite runs MUST go through 'yarn test:integration:ephemeral [filter]' so the runner env block (DATABASE_URL/...) reaches Playwright; bare 'yarn test:integration' with only BASE_URL hits the dev DB. Login probe is form-encoded, never JSON."
}
EOF
  say "TEST_ENV_STATUS=running"
  say "TEST_ENV_BASE_URL=$base"
  say "TEST_ENV_DESCRIPTOR=$ENV_DESCRIPTOR"
  say "TEST_ENV_REUSED=$reused"
}

# --- lock (the mercato CLI has its own owner guard; this serializes wrapper runs) ---
mkdir -p "$QA_DIR" .ai/scripts
waited=0
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  owner_pid=$(sed -n 's/.*"pid": *\([0-9]*\).*/\1/p' "$LOCK_DIR/owner.json" 2>/dev/null | head -1)
  if [ -n "${owner_pid:-}" ] && kill -0 "$owner_pid" 2>/dev/null; then
    [ "$waited" -ge 300 ] && { say "test-env-up: lock held by pid $owner_pid for >300s, giving up"; exit 1; }
    sleep 5; waited=$((waited + 5))
  else
    rm -rf "$LOCK_DIR"
  fi
done
printf '{"pid": %s, "source": "test-env-up.sh", "acquiredAt": "%s"}\n' "$$" "$(date -u +%FT%TZ)" > "$LOCK_DIR/owner.json"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

# --- reuse check: attach, don't reboot ------------------------------------
if [ "$FORCE" -eq 0 ] && [ -f "$STATE_FILE" ]; then
  base=$(sed -n 's/.*"baseUrl": *"\([^"]*\)".*/\1/p' "$STATE_FILE" | head -1)
  if [ -n "$base" ] && probe "$base"; then
    app_pid=$(lsof -tiTCP:"${base##*:}" -sTCP:LISTEN 2>/dev/null | head -1 || true)
    write_descriptor "$base" "${app_pid:-null}" 1
    exit 0
  fi
  say "test-env-up: state file present but probe failed; rebooting"
  rm -f "$STATE_FILE"
fi

# --- zombie-port check (stale next-server can hold the preferred port) -----
zpid=$(lsof -tiTCP:"$PREFERRED_PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)
if [ -n "${zpid:-}" ] && ! probe "http://127.0.0.1:$PREFERRED_PORT"; then
  say "test-env-up: killing unresponsive listener pid $zpid on port $PREFERRED_PORT"
  kill "$zpid" 2>/dev/null || true; sleep 2; kill -9 "$zpid" 2>/dev/null || true
fi

# --- boot via the app's own tooling (it owns build cache + provisioning) ---
say "test-env-up: booting via: $UP_COMMAND (log: $BOOT_LOG)"
nohup sh -c "$UP_COMMAND" > "$BOOT_LOG" 2>&1 &
boot_pid=$!
elapsed=0
until grep -q 'Application is ready' "$BOOT_LOG" 2>/dev/null; do
  if ! kill -0 "$boot_pid" 2>/dev/null || grep -qE 'Type error|💥 Failed' "$BOOT_LOG" 2>/dev/null; then
    say "test-env-up: boot FAILED; last log lines:"; tail -20 "$BOOT_LOG"; exit 1
  fi
  [ "$elapsed" -ge 1200 ] && { say "test-env-up: boot timed out after ${elapsed}s"; tail -20 "$BOOT_LOG"; exit 1; }
  sleep 10; elapsed=$((elapsed + 10))
done
base=$(sed -n 's/.*"baseUrl": *"\([^"]*\)".*/\1/p' "$STATE_FILE" | head -1)
probe "$base" || { say "test-env-up: app reported ready but probe failed at $base"; exit 1; }
app_pid=$(lsof -tiTCP:"${base##*:}" -sTCP:LISTEN 2>/dev/null | head -1 || true)
write_descriptor "$base" "${app_pid:-null}" 0
