#!/bin/sh
set -eu

[ "$#" -eq 0 ] || exit 1
[ ! -L /app/apps/mercato/storage ] || exit 1
[ -d /app/apps/mercato/storage ] || exit 1

exec /bin/chown -h 1001:1001 /app/apps/mercato/storage
