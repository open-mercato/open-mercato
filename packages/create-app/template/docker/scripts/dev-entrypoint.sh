#!/bin/sh
set -e

CONTAINER_REGISTRY_HOST="${OPEN_MERCATO_DOCKER_REGISTRY_HOST:-host.docker.internal}"
YARNRC_BACKUP=""

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
  mv /app/.yarnrc.yml.container /app/.yarnrc.yml
}

trap restore_yarn_config EXIT

cd /app

if [ ! -d node_modules ] \
  || [ -z "$(ls -A node_modules 2>/dev/null)" ] \
  || [ ! -d node_modules/@open-mercato/cli ] \
  || [ ! -x node_modules/.bin/mercato ]; then
  prepare_container_yarn_config
  echo "Installing dependencies..."
  yarn install
  restore_yarn_config
fi

sh /app/docker/scripts/init-or-migrate.sh

exec yarn dev
