#!/usr/bin/env bash
# Roll out a new image to an environment: apply Terraform with the new tag, then migrate.
#
#   ./deploy.sh <env> <image>
#
# Example:
#   ./deploy.sh prod ghcr.io/open-mercato/open-mercato:prod-abc1234
#
# Ordering note: this applies (registering new task defs + rolling the web service behind
# the ECS deployment circuit breaker) and then runs idempotent migrations. For ADDITIVE
# migrations this is safe. For DESTRUCTIVE migrations, run ./migrate.sh first in a
# maintenance window — see the runbook.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require terraform

ENV="${1:-}"; IMAGE="${2:-}"
[ -n "${ENV}" ] && [ -n "${IMAGE}" ] || { echo "Usage: $0 <env> <image>" >&2; exit 1; }

echo "==> terraform apply (${ENV}) with image=${IMAGE}"
tf "${ENV}" apply -var "image=${IMAGE}"

echo "==> running migrations (${ENV})"
"$(dirname "${BASH_SOURCE[0]}")/migrate.sh" "${ENV}" migrate

echo "==> forcing a fresh deployment of the web service"
CLUSTER="$(tf_out "${ENV}" cluster_name)"
WEB="$(tf_out "${ENV}" web_service_name)"
aws ecs update-service --cluster "${CLUSTER}" --service "${WEB}" --force-new-deployment >/dev/null
echo "Done. Watch rollout:  aws ecs wait services-stable --cluster ${CLUSTER} --services ${WEB}"
