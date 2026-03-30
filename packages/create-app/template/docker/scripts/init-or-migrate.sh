#!/bin/sh
set -e

MARKER_FILE="${INIT_MARKER_FILE:-/tmp/init-marker/.seeded}"
INIT_COMMAND="${INIT_COMMAND:-yarn initialize}"
MIGRATE_COMMAND="${MIGRATE_COMMAND:-yarn db:migrate}"
ALREADY_INITIALIZED_PATTERN='Initialization aborted: found [0-9][0-9]* existing user\(s\) in the database\.'

if [ ! -f "${MARKER_FILE}" ]; then
  echo "First run: full initialization..."
  LOG_FILE="$(mktemp)"

  if sh -lc "${INIT_COMMAND}" >"${LOG_FILE}" 2>&1; then
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
      sh -lc "${MIGRATE_COMMAND}"
      mkdir -p "$(dirname "${MARKER_FILE}")"
      touch "${MARKER_FILE}"
      exit 0
    fi

    rm -f "${LOG_FILE}"
    exit "${STATUS}"
  fi
fi

echo "Subsequent run: migrations only..."
sh -lc "${MIGRATE_COMMAND}"
