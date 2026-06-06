#!/usr/bin/env bash
# Shared helpers for the deploy/aws operator scripts.
# Requires: awscli v2, terraform (or tofu aliased), jq.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TF_BASE="${REPO_ROOT}/deploy/aws/terraform/environments"

require() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }; }
require aws
require jq

tf() {
  # tf <env> <terraform-args...>
  local env="$1"; shift
  terraform -chdir="${TF_BASE}/${env}" "$@"
}

tf_out() {
  # tf_out <env> <output-name>  -> raw value
  tf "$1" output -raw "$2"
}

usage_env() {
  echo "Usage: $0 <env> ..." >&2
  echo "  <env> is one of: dev | staging | prod" >&2
  exit 1
}
