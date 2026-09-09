#!/bin/sh
set -e

MARKER_FILE="${INIT_MARKER_FILE:-/tmp/init-marker/.seeded}"
INIT_COMMAND="${INIT_COMMAND:-yarn initialize}"
MIGRATE_COMMAND="${MIGRATE_COMMAND:-yarn db:migrate}"
SYNC_ROLE_ACLS_COMMAND="${SYNC_ROLE_ACLS_COMMAND:-yarn mercato auth sync-role-acls}"
ALREADY_INITIALIZED_PATTERN='Initialization aborted: found [0-9][0-9]* existing user\(s\) in the database\.'
CLI_NOT_FOUND_PATTERN='command not found: mercato'

run_command_with_cli_recovery() {
  COMMAND="$1"
  LOG_FILE="$2"

  # `STATUS=$?` after a failed `if ...; then ...; fi` reads the compound statement's own
  # status, which POSIX defines as 0 — so every failure used to be reported as success and
  # a broken migration silently fell through to `yarn start`. Capture the status directly.
  STATUS=0
  sh -lc "${COMMAND}" >"${LOG_FILE}" 2>&1 || STATUS=$?

  if [ "${STATUS}" -eq 0 ]; then
    return 0
  fi

  if ! grep -Fq "${CLI_NOT_FOUND_PATTERN}" "${LOG_FILE}"; then
    return "${STATUS}"
  fi

  echo "Open Mercato CLI missing; running yarn install and retrying..."
  yarn install
  sh -lc "${COMMAND}" >"${LOG_FILE}" 2>&1
}

# Modules enabled after the database was first seeded declare new `defaultRoleFeatures`
# that existing tenants never received — `mercato init` applies them only at bootstrap.
# The sync command is idempotent, so run it after every migration and keep it non-fatal:
# a stale grant set must not block the container from starting.
sync_role_acls() {
  SYNC_LOG_FILE="$(mktemp)"

  if run_command_with_cli_recovery "${SYNC_ROLE_ACLS_COMMAND}" "${SYNC_LOG_FILE}"; then
    cat "${SYNC_LOG_FILE}"
  else
    echo "WARNING: role ACL sync failed; newly enabled modules may be inaccessible until it is run manually."
    cat "${SYNC_LOG_FILE}"
  fi

  rm -f "${SYNC_LOG_FILE}"
}

if [ ! -f "${MARKER_FILE}" ]; then
  echo "First run: full initialization..."
  LOG_FILE="$(mktemp)"

  if run_command_with_cli_recovery "${INIT_COMMAND}" "${LOG_FILE}"; then
    cat "${LOG_FILE}"
    rm -f "${LOG_FILE}"
    mkdir -p "$(dirname "${MARKER_FILE}")"
    touch "${MARKER_FILE}"
    exit 0
  else
    STATUS=$?
    cat "${LOG_FILE}"

    if grep -Eq "${ALREADY_INITIALIZED_PATTERN}" "${LOG_FILE}"; then
      rm -f "${LOG_FILE}"
      echo "Initialization reported existing users; treating database as already initialized."
      echo "Running migrations..."
      RECOVERY_LOG_FILE="$(mktemp)"
      if run_command_with_cli_recovery "${MIGRATE_COMMAND}" "${RECOVERY_LOG_FILE}"; then
        cat "${RECOVERY_LOG_FILE}"
        rm -f "${RECOVERY_LOG_FILE}"
        sync_role_acls
      else
        RECOVERY_STATUS=$?
        cat "${RECOVERY_LOG_FILE}"
        rm -f "${RECOVERY_LOG_FILE}"
        exit "${RECOVERY_STATUS}"
      fi
      mkdir -p "$(dirname "${MARKER_FILE}")"
      touch "${MARKER_FILE}"
      exit 0
    fi

    rm -f "${LOG_FILE}"
    exit "${STATUS}"
  fi
fi

echo "Subsequent run: migrations only..."
LOG_FILE="$(mktemp)"

if run_command_with_cli_recovery "${MIGRATE_COMMAND}" "${LOG_FILE}"; then
  cat "${LOG_FILE}"
  rm -f "${LOG_FILE}"
  sync_role_acls
  exit 0
fi

STATUS=$?
cat "${LOG_FILE}"
rm -f "${LOG_FILE}"
exit "${STATUS}"
