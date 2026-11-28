#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

registry=apps/mercato/src/modules.ts
registry_backup=$(mktemp)
cp "$registry" "$registry_backup"
trap 'cat "$registry_backup" > "$registry" && rm -f "$registry_backup"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

node --input-type=module - "$registry" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs'

const registryPath = process.argv[2]
const source = readFileSync(registryPath, 'utf8')
const configsEntry = /^[ \t]*\{ id: 'configs', from: '@open-mercato\/core' \},\r?\n/gm

if ([...source.matchAll(configsEntry)].length !== 1) {
  throw new Error('Expected exactly one Configs entry in the default module registry')
}

writeFileSync(registryPath, source.replace(configsEntry, ''))
NODE

# The ephemeral runner initializes the database before its forced rebuild.
yarn workspace @open-mercato/app generate
yarn build:packages
OM_INTEGRATION_CONFIGS_OMITTED=1 OM_INTEGRATION_MODULES=entities \
  yarn test:integration:ephemeral TC-ENT-9197-settings-without-configs.spec.ts --no-reuse-env --force-rebuild
