import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { installNextSubpathResolveHook } from '@open-mercato/shared/lib/bootstrap/next-subpath-resolve-hook'

const appRoot = fileURLToPath(new URL('..', import.meta.url))

try {
  installNextSubpathResolveHook()
  const envFile = new URL('../.env', import.meta.url)
  if (existsSync(envFile)) process.loadEnvFile(envFile)

  const { bootstrapFromAppRoot } = await import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
  await bootstrapFromAppRoot(appRoot)

  const { runLegacyCommandCleanup } = await import('@open-mercato/core/modules/notifications/lib/runLegacyCommandCleanup')
  await runLegacyCommandCleanup(process.argv.slice(2))
  const { flushBeforeExit } = await import('@open-mercato/cli/lib/flush-before-exit')
  await flushBeforeExit()
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
