#!/usr/bin/env bash
# Open an interactive shell inside a running web task via ECS Exec.
#
#   ./exec.sh <env> [command]
#
# Default command is `sh`. Requires the service to have enable_execute_command = true
# (it does) and the AWS Session Manager plugin installed locally.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

ENV="${1:-}"; shift || true
CMD="${*:-/bin/sh}"
[ -n "${ENV}" ] || usage_env

CLUSTER="$(tf_out "${ENV}" cluster_name)"
WEB="$(tf_out "${ENV}" web_service_name)"
TASK_ARN="$(aws ecs list-tasks --cluster "${CLUSTER}" --service-name "${WEB}" \
  --desired-status RUNNING --query 'taskArns[0]' --output text)"
[ "${TASK_ARN}" != "None" ] || { echo "No running web task found." >&2; exit 1; }

CONTAINER="$(aws ecs describe-tasks --cluster "${CLUSTER}" --tasks "${TASK_ARN}" \
  --query 'tasks[0].containers[0].name' --output text)"

exec aws ecs execute-command --cluster "${CLUSTER}" --task "${TASK_ARN}" \
  --container "${CONTAINER}" --interactive --command "${CMD}"
