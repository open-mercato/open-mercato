import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { applyDiscordEnvPreset } from './lib/preset'
import { assertInboundDeliverable } from './lib/queue-strategy'
import gatewayHandle, { CHANNEL_DISCORD_GATEWAY_QUEUE } from './workers/discord-gateway'

const logger = createLogger('channel_discord').child({ component: 'cli' })

/**
 * Split `--key value` pairs from bare `--flag` switches so a boolean flag does
 * not shift the positional pairing of the remaining arguments.
 */
export function parseFlagsAndValues(args: string[]): { flags: Set<string>; values: Record<string, string> } {
  const flags = new Set<string>()
  const values: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token?.startsWith('-')) continue
    const key = token.replace(/^-+/, '')
    const next = args[index + 1]
    if (next && !next.startsWith('-')) {
      values[key] = next
      index += 1
    } else {
      flags.add(key)
    }
  }
  return { flags, values }
}

/**
 * Start the Discord Gateway bridge.
 *
 * WHY THIS EXISTS: the provider advertises `realtimePush: true`, so the hub's
 * polling scheduler skips Discord channels — inbound relies entirely on this
 * long-running gateway worker. Nothing enqueues the `channel_discord_gateway`
 * job automatically (no hub "channel connected" event exists), so inbound is
 * dead until an operator starts this process. This command enqueues the initial
 * bootstrap job, runs the worker, and (by default) re-enqueues a refresh job on
 * an interval so newly connected channels are picked up and deactivated /
 * soft-deleted channels are reconciled away (sockets closed).
 *
 * The refresh job is a reconciler, not a re-connector: the worker leaves every
 * channel whose gateway session is still running untouched, so a short interval
 * costs one query per tick and never disturbs a healthy socket.
 *
 * Usage:
 *   mercato channel_discord start-gateway [--tenant <tenantId>] [--refresh <seconds>]
 *
 * `--refresh 0` disables the periodic refresh (single reconciliation at startup).
 * Set `OM_CHANNEL_DISCORD_GATEWAY_DISABLED=1` to make the worker a no-op.
 */
const startGateway: ModuleCli = {
  command: 'start-gateway',
  async run(rest: string[]) {
    const { values } = parseFlagsAndValues(rest)
    const tenantId = values.tenant ?? values.tenantId ?? values.t
    const refreshSeconds = Number.isFinite(Number(values.refresh ?? values.r))
      ? Math.max(0, Number(values.refresh ?? values.r))
      : 60

    assertInboundDeliverable(process.env.QUEUE_STRATEGY)

    logger.info('starting Discord gateway bridge', {
      queue: CHANNEL_DISCORD_GATEWAY_QUEUE,
      tenantId: tenantId ?? 'all',
      refreshSeconds,
    })

    const container = await createRequestContainer()

    const { createModuleQueue, runWorker } = await import('@open-mercato/queue')

    const jobPayload = tenantId ? { tenantId } : {}

    // The worker context only needs `.resolve`; the queue runner's own ctx does
    // not carry the DI container, so we close over the request container here
    // (mirrors workflows' `start-worker`).
    const handler = async (job: { payload?: Record<string, unknown> }): Promise<void> => {
      await gatewayHandle(job as never, { resolve: (name: string) => container.resolve(name) } as never)
    }

    await runWorker({
      queueName: CHANNEL_DISCORD_GATEWAY_QUEUE,
      handler: handler as never,
      concurrency: 1,
      gracefulShutdown: true,
      background: true,
    })

    const queue = createModuleQueue<Record<string, unknown>>(CHANNEL_DISCORD_GATEWAY_QUEUE, { concurrency: 1 })
    await queue.enqueue({ ...jobPayload, reason: 'startup' })
    logger.info('enqueued gateway bootstrap job')

    if (refreshSeconds > 0) {
      setInterval(() => {
        queue
          .enqueue({ ...jobPayload, reason: 'refresh' })
          .catch((err) => logger.warn('failed to enqueue gateway refresh job', { err }))
      }, refreshSeconds * 1000)
    }

    logger.info('Discord gateway bridge running — press Ctrl+C to stop')
    // Keep the process alive so the sockets + refresh interval persist.
    await new Promise<void>(() => {})
  },
}

/**
 * Rerun the provider-owned env preconfiguration for one tenant + organization.
 *
 * `setup.ts` applies the same preset when a tenant is created; this command
 * exists so an operator can apply it to tenants that already existed when the
 * `OM_CHANNEL_DISCORD_*` vars were introduced, or re-apply it after rotating the
 * bot token (with `--force`). Idempotent: without `--force` an existing
 * credential record is left untouched.
 */
const configureFromEnv: ModuleCli = {
  command: 'configure-from-env',
  async run(rest: string[]) {
    const { flags, values } = parseFlagsAndValues(rest)
    const tenantId = values.tenant ?? values.tenantId
    const organizationId = values.org ?? values.organization ?? values.organizationId

    if (!tenantId || !organizationId) {
      logger.error('configure-from-env requires --tenant <tenantId> --org <organizationId>')
      throw new Error('[internal] channel_discord configure-from-env requires --tenant and --org')
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const result = await applyDiscordEnvPreset({
      credentialsService: createCredentialsService(em),
      integrationLogService: createIntegrationLogService(em),
      scope: { tenantId, organizationId },
      force: flags.has('force'),
    })

    if (result.status === 'configured') {
      logger.info('Discord integration preconfigured from environment', { tenantId, organizationId })
    } else {
      logger.info('Discord env preconfiguration skipped', { tenantId, organizationId, reason: result.reason })
    }
  },
}

const channelDiscordCliCommands = [startGateway, configureFromEnv]

export default channelDiscordCliCommands
