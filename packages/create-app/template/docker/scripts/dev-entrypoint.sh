#!/bin/sh
set -e

CONTAINER_REGISTRY_HOST="${OPEN_MERCATO_DOCKER_REGISTRY_HOST:-host.docker.internal}"
YARNRC_BACKUP=""
INSTALL_STATE_FILE="/app/node_modules/.open-mercato-install-state"

restore_yarn_config() {
  if [ -n "${YARNRC_BACKUP}" ] && [ -f "${YARNRC_BACKUP}" ]; then
    mv "${YARNRC_BACKUP}" /app/.yarnrc.yml
    YARNRC_BACKUP=""
  fi
}

prepare_container_yarn_config() {
  if [ ! -f /app/.yarnrc.yml ]; then
    return
  fi

  if ! grep -Eq 'http://(localhost|127\.0\.0\.1):' /app/.yarnrc.yml; then
    return
  fi

  YARNRC_BACKUP="$(mktemp /tmp/open-mercato-yarnrc.XXXXXX)"
  cp /app/.yarnrc.yml "${YARNRC_BACKUP}"
  sed \
    -e "s#http://localhost:#http://${CONTAINER_REGISTRY_HOST}:#g" \
    -e "s#http://127.0.0.1:#http://${CONTAINER_REGISTRY_HOST}:#g" \
    /app/.yarnrc.yml > /app/.yarnrc.yml.container
  if ! grep -Eq '^checksumBehavior:' /app/.yarnrc.yml.container; then
    printf '\nchecksumBehavior: update\n' >> /app/.yarnrc.yml.container
  fi
  mv /app/.yarnrc.yml.container /app/.yarnrc.yml
}

compute_install_state() {
  for file in /app/package.json /app/yarn.lock /app/.yarnrc.yml; do
    if [ -f "${file}" ]; then
      cksum "${file}"
    else
      printf 'missing %s\n' "${file}"
    fi
  done
}

is_cli_ready() {
  [ -d /app/node_modules ] \
    && [ -n "$(ls -A /app/node_modules 2>/dev/null)" ] \
    && [ -d /app/node_modules/@open-mercato/cli ] \
    && [ -x /app/node_modules/.bin/mercato ] \
    && [ -x /app/node_modules/@open-mercato/cli/bin/mercato ]
}

should_install_dependencies() {
  if ! is_cli_ready; then
    return 0
  fi

  if [ ! -f "${INSTALL_STATE_FILE}" ]; then
    return 0
  fi

  CURRENT_STATE="$(compute_install_state)"
  SAVED_STATE="$(cat "${INSTALL_STATE_FILE}" 2>/dev/null || true)"
  [ "${CURRENT_STATE}" != "${SAVED_STATE}" ]
}

reset_node_modules() {
  if [ ! -d /app/node_modules ]; then
    return
  fi

  find /app/node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} +
}

record_install_state() {
  mkdir -p /app/node_modules
  compute_install_state > "${INSTALL_STATE_FILE}"
}
trap restore_yarn_config EXIT

cd /app

if should_install_dependencies; then
  prepare_container_yarn_config
  echo "Installing dependencies..."
  reset_node_modules
  yarn install
  restore_yarn_config
  record_install_state
fi

sh /app/docker/scripts/init-or-migrate.sh

exec yarn dev
