#!/usr/bin/env bash
# Tail CloudWatch logs for a service in an environment.
#
#   ./logs.sh <env> [web|worker|meilisearch|migrate]
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

ENV="${1:-}"; SVC="${2:-web}"
[ -n "${ENV}" ] || usage_env

PREFIX="$(tf_out "${ENV}" name_prefix)"
GROUP="${PREFIX}-${SVC}"
echo "Tailing log group: ${GROUP}"
aws logs tail "${GROUP}" --follow --since 10m
