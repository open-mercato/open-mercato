#!/bin/sh
# Build-time only: never installs tools from an operator CLI invocation.
set -eu
major=${1:-17}
case "$major" in 16|17|18) ;; *) echo 'Unsupported POSTGRES_CLIENT_MAJOR; choose 16, 17 or 18.' >&2; exit 2 ;; esac
apk add --no-cache "postgresql${major}-client"
binaries="/usr/libexec/postgresql${major}"
for tool in psql pg_dump pg_restore; do
  [ -x "$binaries/$tool" ] || { echo "Missing PostgreSQL client: $tool" >&2; exit 1; }
  "$binaries/$tool" --version | grep -Eq "\\(PostgreSQL\\) ${major}([.]|$)" || { echo "Unexpected PostgreSQL client major: $tool" >&2; exit 1; }
done
