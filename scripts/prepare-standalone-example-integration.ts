import assert from 'node:assert/strict'
import path from 'node:path'

import {
  DESIGN_SYSTEM_ACTIVATION_ENTRY,
  EXAMPLE_INTEGRATION_ACTIVATION_ENTRY,
  assertModulesUnregistered,
  enableModuleEntry,
  modulesConfigPath,
} from './lib/module-activation-fixtures'

async function main(): Promise<void> {
  const appDirArgument = process.argv[2]
  assert.ok(appDirArgument, 'Usage: yarn tsx scripts/prepare-standalone-example-integration.ts <app-directory>')

  const appDir = path.resolve(appDirArgument)

  await assertModulesUnregistered(appDir, ['example', 'example_customers_sync', 'design_system'])
  const configPath = modulesConfigPath(appDir)
  enableModuleEntry(configPath, EXAMPLE_INTEGRATION_ACTIVATION_ENTRY)
  enableModuleEntry(configPath, DESIGN_SYSTEM_ACTIVATION_ENTRY)

  console.log(`Verified the runtime-disabled module baseline and activated the standalone integration fixtures in ${appDir}`)
}

void main()
