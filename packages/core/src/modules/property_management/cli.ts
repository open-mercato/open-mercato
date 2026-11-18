import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { listSweepScopes, runLeaseSweep } from './lib/leaseSweep'
import { runBookingSweep } from './lib/bookingSweep'
import { resolveOperationHandler } from './lib/operationHandlers'
import { runSalesOperation } from './lib/salesOperationRunner'
import type { OperationEnqueuer } from './lib/salesOperations'

function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part?.startsWith('--')) continue
    const [rawKey, rawValue] = part.slice(2).split('=')
    if (rawValue !== undefined) {
      args[rawKey] = rawValue
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[rawKey] = next
      index += 1
    } else {
      args[rawKey] = 'true'
    }
  }
  return args
}

function inlineEnqueuer(container: AwilixContainer, em: EntityManager): OperationEnqueuer {
  const run = async (operationIds: readonly string[]): Promise<void> => {
    for (const operationId of operationIds) {
      try {
        await runSalesOperation({ container, em, resolveHandler: resolveOperationHandler, enqueuer: run }, operationId)
      } catch (err) {
        console.error(`Sales operation ${operationId} failed:`, err instanceof Error ? err.message : err)
        getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.sweep_cli_operation_failed' })
      }
    }
  }
  return run
}

const sweepRunCommand: ModuleCli = {
  command: 'sweep:run',
  async run(rest) {
    const args = parseArgs(rest)
    const organizationFilter = args.org ?? args.organizationId ?? null
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    try {
      const scopes = (await listSweepScopes(em)).filter((scope) => !organizationFilter || scope.organizationId === organizationFilter)
      if (!scopes.length) {
        console.log('No organization has leases or bookings yet; nothing to sweep.')
        return
      }
      const enqueuer = inlineEnqueuer(container, em)
      for (const scope of scopes) {
        const summary = await runLeaseSweep({ container, em, enqueuer }, scope)
        const bookings = await runBookingSweep({ container, em, enqueuer, skipReenqueue: true }, scope)
        console.log(
          `Organization ${scope.organizationId}: ended ${summary.ended}, expired ${summary.expired}, reminded ${summary.reminded}, bookings completed ${bookings.completed}, billing operations retried ${summary.reenqueued}, unavailabilities resumed ${bookings.resumedClosures}`,
        )
      }
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') await disposable.dispose()
    }
  },
}

const commands: ModuleCli[] = [sweepRunCommand]

export default commands
