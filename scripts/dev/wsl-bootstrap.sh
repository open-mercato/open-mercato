#!/usr/bin/env bash
set -euo pipefail

# Bootstrap Open Mercato local dev for WSL:
# - Generates docker/.env.dev for docker-compose.yml (Postgres/Redis)
# - Generates apps/mercato/.env for the Next.js app
# - Defaults to NO Meilisearch and NO vector/embedding providers
# - Does NOT print secret values (they are written to files)

force=0
copy_to_home=0

for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --copy-to-home) copy_to_home=1 ;;
    *)
      echo "Unknown arg: $arg" >&2
      echo "Usage: $0 [--force] [--copy-to-home]" >&2
      exit 2
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"

if [[ "$copy_to_home" == "1" ]]; then
  if [[ "$repo_root" == /mnt/* ]]; then
    if command -v rsync >/dev/null 2>&1; then
      target="$HOME/open-ezd"
      echo "[bootstrap] Copying repo from $repo_root -> $target (excluding node_modules/.git/.next)..."
      mkdir -p "$target"
      rsync -a --delete \
        --exclude '.git' \
        --exclude 'node_modules' \
        --exclude '.next' \
        --exclude '.turbo' \
        --exclude '.yarn/cache' \
        "$repo_root/" "$target/"
      repo_root="$target"
      echo "[bootstrap] Using repo root: $repo_root"
    else
      echo "[bootstrap] rsync not found. Install with: sudo apt-get update; sudo apt-get install -y rsync" >&2
      exit 1
    fi
  else
    echo "[bootstrap] Repo is already on the WSL filesystem: $repo_root"
  fi
fi

app_env_example="$repo_root/apps/mercato/.env.example"
app_env="$repo_root/apps/mercato/.env"
compose_env_dir="$repo_root/docker"
compose_env_example="$compose_env_dir/.env.dev.example"
compose_env="$compose_env_dir/.env.dev"

if [[ ! -f "$app_env_example" ]]; then
  echo "[bootstrap] Missing: $app_env_example" >&2
  exit 1
fi

mkdir -p "$compose_env_dir"
if [[ ! -f "$compose_env_example" ]]; then
  echo "[bootstrap] Missing: $compose_env_example" >&2
  exit 1
fi

if [[ -f "$app_env" && "$force" != "1" ]]; then
  echo "[bootstrap] $app_env already exists. Re-run with --force to overwrite." >&2
  exit 1
fi

if [[ -f "$compose_env" && "$force" != "1" ]]; then
  echo "[bootstrap] $compose_env already exists. Re-run with --force to overwrite." >&2
  exit 1
fi

cp "$app_env_example" "$app_env"
cp "$compose_env_example" "$compose_env"

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    python3 - <<PY
import secrets
print(secrets.token_hex(int($1)))
PY
  fi
}

rand_b64() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$1" | tr -d '\n'
  else
    python3 - <<PY
import secrets, base64
print(base64.b64encode(secrets.token_bytes(int($1))).decode('ascii'))
PY
  fi
}

set_kv() {
  local file="$1" key="$2" value="$3"
  python3 - <<'PY' "$file" "$key" "$value"
import re, sys
path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
line_re = re.compile(r'^' + re.escape(key) + r'=.*$')
out = []
found = False
with open(path, 'r', encoding='utf-8') as f:
  for line in f:
    if line_re.match(line.rstrip('\n')):
      out.append(f"{key}={value}\n")
      found = True
    else:
      out.append(line)
if not found:
  out.append(f"{key}={value}\n")
with open(path, 'w', encoding='utf-8') as f:
  f.writelines(out)
PY
}

postgres_user="postgres"
postgres_db="open-mercato"
postgres_port="5432"
postgres_password="$(rand_b64 24)"

jwt_secret="$(rand_hex 32)"
tenant_fallback_key="$(rand_b64 48)"

set_kv "$compose_env" POSTGRES_USER "$postgres_user"
set_kv "$compose_env" POSTGRES_PASSWORD "$postgres_password"
set_kv "$compose_env" POSTGRES_DB "$postgres_db"
set_kv "$compose_env" POSTGRES_PORT "$postgres_port"

database_url="postgres://${postgres_user}:${postgres_password}@localhost:${postgres_port}/${postgres_db}"

set_kv "$app_env" POSTGRES_USER "$postgres_user"
set_kv "$app_env" POSTGRES_PASSWORD "$postgres_password"
set_kv "$app_env" POSTGRES_DB "$postgres_db"
set_kv "$app_env" POSTGRES_PORT "$postgres_port"
set_kv "$app_env" DATABASE_URL "$database_url"
set_kv "$app_env" JWT_SECRET "$jwt_secret"
set_kv "$app_env" TENANT_DATA_ENCRYPTION_FALLBACK_KEY "$tenant_fallback_key"

# No Meilisearch / vector search in this profile
set_kv "$app_env" QUEUE_STRATEGY "local"
set_kv "$app_env" AUTO_SPAWN_WORKERS "true"
set_kv "$app_env" OPENMERCATO_DEFAULT_ATTACHMENT_OCR_ENABLED "false"

echo "[bootstrap] Wrote: docker/.env.dev (compose env)"
echo "[bootstrap] Wrote: apps/mercato/.env (app env)"
echo ""
echo "Next (run inside WSL):"
echo "  cd $repo_root"
echo "  docker compose --env-file docker/.env.dev -f docker-compose.yml up -d postgres redis"
echo "  corepack yarn install"
echo "  corepack yarn build:packages"
echo "  corepack yarn generate"
echo "  corepack yarn db:migrate"
echo "  corepack yarn initialize --no-examples"
echo "  corepack yarn dev"
echo ""
echo "Windows browser: http://localhost:3000"