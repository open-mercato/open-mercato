#!/usr/bin/env bash
# Seed the out-of-band secrets (and GHCR pull credentials) for an environment.
# Secret VALUES never live in Terraform — this writes them straight to Secrets Manager.
#
#   ./seed-secrets.sh <env>
#
# Prompts for each seeded secret. Leave a prompt blank to skip (keep existing value).
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

ENV="${1:-}"
[ -n "${ENV}" ] || usage_env

echo "Reading secret ARNs from Terraform outputs for '${ENV}'..."
SEEDED_JSON="$(tf "${ENV}" output -json seeded_secret_arns)"
REGISTRY_ARN="$(tf_out "${ENV}" registry_credentials_secret_arn || true)"

put() {
  local arn="$1" value="$2"
  aws secretsmanager put-secret-value --secret-id "${arn}" --secret-string "${value}" >/dev/null
  echo "  updated: ${arn}"
}

echo
echo "== Application secrets =="
for name in $(echo "${SEEDED_JSON}" | jq -r 'keys[]'); do
  arn="$(echo "${SEEDED_JSON}" | jq -r --arg n "${name}" '.[$n]')"
  printf "Enter value for %s (blank to skip): " "${name}"
  read -rs value; echo
  if [ -n "${value}" ]; then put "${arn}" "${value}"; else echo "  skipped ${name}"; fi
done

if [ -n "${REGISTRY_ARN}" ] && [ "${REGISTRY_ARN}" != "null" ]; then
  echo
  echo "== GHCR pull credentials (read:packages PAT) =="
  printf "GHCR username (blank to skip): "; read -r gh_user
  if [ -n "${gh_user}" ]; then
    printf "GHCR token (read:packages): "; read -rs gh_token; echo
    put "${REGISTRY_ARN}" "$(jq -nc --arg u "${gh_user}" --arg p "${gh_token}" '{username:$u,password:$p}')"
  else
    echo "  skipped GHCR credentials"
  fi
fi

echo
echo "Done. Tip: generate strong values with:  openssl rand -hex 32"
