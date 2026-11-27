import { resolve } from 'node:path'
import { installNextSubpathResolveHook } from '@open-mercato/shared/lib/bootstrap/next-subpath-resolve-hook'

async function main() {
  installNextSubpathResolveHook()
  process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT = 'on'
  const { runRepair } = await import('./repair.js')
  const result = await runRepair(process.argv.slice(2), async () => {
    const appDir = resolve('apps/mercato')
    const { loadAppEnv } = await import('@open-mercato/cli/lib/load-env')
    await loadAppEnv({ cwd: appDir })
    const { bootstrapFromAppRoot } = await import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
    await bootstrapFromAppRoot(appDir)
  })
  const { flushBeforeExit } = await import('@open-mercato/cli/lib/flush-before-exit')
  await flushBeforeExit()
  await new Promise<void>((done, reject) => {
    process.stdout.write(`${JSON.stringify(result)}\n`, (error) => error ? reject(error) : done())
  })
}

try {
  await main()
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
