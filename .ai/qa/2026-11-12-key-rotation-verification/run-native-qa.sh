#!/bin/sh
set -eu
umask 077

cd "$(CDPATH= cd "$(dirname "$0")/../../.." && pwd)"
for command in node yarn docker curl openssl; do
  command -v "$command" >/dev/null || { printf 'Required command: %s\n' "$command" >&2; exit 1; }
done
if [ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]; then
  printf '%s\n' 'Use Node.js 24 to run the rotation QA fixture.' >&2
  exit 1
fi
docker info >/dev/null
yarn install --immutable

fixture=$(mktemp -d "${TMPDIR:-/tmp}/om-rotation-qa.XXXXXX")
fixture_suffix=${fixture##*.}
postgres_container="om-rotation-qa-$fixture_suffix-postgres"
vault_container="om-rotation-qa-$fixture_suffix-vault"
postgres_id=
vault_id=

cleanup() {
  if [ -n "$vault_id" ]; then docker stop "$vault_id" >/dev/null 2>&1 || :; fi
  if [ -n "$postgres_id" ]; then docker stop "$postgres_id" >/dev/null 2>&1 || :; fi
  rm -f "$fixture/postgres.env" "$fixture/vault.env" "$fixture/vault-token.txt"
  rmdir "$fixture"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

postgres_password=$(openssl rand -hex 16)
vault_token=$(openssl rand -hex 24)
printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password" > "$fixture/postgres.env"
printf 'VAULT_DEV_ROOT_TOKEN_ID=%s\nVAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200\n' "$vault_token" > "$fixture/vault.env"
printf '%s' "$vault_token" > "$fixture/vault-token.txt"

postgres_id=$(docker run -d --rm --name "$postgres_container" \
  --env-file "$fixture/postgres.env" -p 127.0.0.1::5432 postgres:16 -c autovacuum=off)
vault_id=$(docker run -d --rm --name "$vault_container" \
  --env-file "$fixture/vault.env" --cap-add=IPC_LOCK -p 127.0.0.1::8200 hashicorp/vault:1.21.4 server -dev)
postgres_port=$(docker port "$postgres_id" 5432/tcp | awk -F: '{print $NF}')
vault_port=$(docker port "$vault_id" 8200/tcp | awk -F: '{print $NF}')

export OM_ROTATION_TEST_DATABASE_URL="postgresql://postgres:$postgres_password@127.0.0.1:$postgres_port/postgres"
export OM_ROTATION_TEST_CONTAINER="$postgres_container"
export OM_ROTATION_TEST_VAULT_ADDR="http://127.0.0.1:$vault_port"
export OM_ROTATION_TEST_VAULT_TOKEN_FILE="$fixture/vault-token.txt"

attempt=0
until docker exec "$postgres_id" pg_isready -h 127.0.0.1 -U postgres -t 1 >/dev/null 2>&1 &&
  curl -fsS --max-time 2 "$OM_ROTATION_TEST_VAULT_ADDR/v1/sys/health" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    printf '%s\n' 'The disposable PostgreSQL or Vault service did not become ready.' >&2
    exit 1
  fi
  sleep 1
done

yarn workspace @open-mercato/enterprise test --runInBand --runTestsByPath \
  src/modules/backups/lib/rotation-verification/__tests__/cli-production.test.ts
