#!/usr/bin/env bash
# Run the one-off migration (or first-run init) ECS task and wait for it to finish.
#
#   ./migrate.sh <env> [migrate|init]
#
#   migrate (default) -> runs the registered task def command: `yarn mercato db migrate`
#   init              -> overrides the command to `yarn mercato init` (fresh DB bootstrap only)
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

ENV="${1:-}"; MODE="${2:-migrate}"
[ -n "${ENV}" ] || usage_env

CLUSTER="$(tf_out "${ENV}" cluster_name)"
FAMILY="$(tf_out "${ENV}" migration_task_family)"
SUBNETS="$(tf "${ENV}" output -json private_subnet_ids | jq -r 'join(",")')"
SG="$(tf_out "${ENV}" ecs_tasks_security_group_id)"
CONTAINER="$(aws ecs describe-task-definition --task-definition "${FAMILY}" \
  --query 'taskDefinition.containerDefinitions[0].name' --output text)"

NET="awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SG}],assignPublicIp=DISABLED}"

RUN_ARGS=(--cluster "${CLUSTER}" --task-definition "${FAMILY}" --launch-type FARGATE \
  --network-configuration "${NET}" --query 'tasks[0].taskArn' --output text)

if [ "${MODE}" = "init" ]; then
  echo "Running FIRST-RUN init (yarn mercato init) on ${ENV}..."
  OVERRIDE="$(jq -nc --arg c "${CONTAINER}" '{containerOverrides:[{name:$c,command:["yarn","mercato","init"]}]}')"
  RUN_ARGS+=(--overrides "${OVERRIDE}")
else
  echo "Running migrations (yarn mercato db migrate) on ${ENV}..."
fi

TASK_ARN="$(aws ecs run-task "${RUN_ARGS[@]}")"
echo "Task: ${TASK_ARN}"
echo "Waiting for task to stop..."
aws ecs wait tasks-stopped --cluster "${CLUSTER}" --tasks "${TASK_ARN}"

EXIT_CODE="$(aws ecs describe-tasks --cluster "${CLUSTER}" --tasks "${TASK_ARN}" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
REASON="$(aws ecs describe-tasks --cluster "${CLUSTER}" --tasks "${TASK_ARN}" \
  --query 'tasks[0].stoppedReason' --output text)"

if [ "${EXIT_CODE}" = "0" ]; then
  echo "Migration task succeeded (exit 0)."
else
  echo "Migration task FAILED (exit ${EXIT_CODE}). Reason: ${REASON}" >&2
  echo "Check logs:  ./logs.sh ${ENV} migrate" >&2
  exit 1
fi
