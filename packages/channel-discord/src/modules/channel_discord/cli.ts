import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import gatewayHandle, { CHANNEL_DISCORD_GATEWAY_QUEUE } from './workers/discord-gateway'

const logger = createLogger('channel_discord').child({ component: 'cli' })

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^-+/, '')
    const value = args[i + 1]
    if (key && value) result[key] = value
  }
  return result
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
 * Usage:
 *   mercato channel_discord start-gateway [--tenant <tenantId>] [--refresh <seconds>]
 *
 * `--refresh 0` disables the periodic refresh (single reconciliation at startup).
 * Set `OM_CHANNEL_DISCORD_GATEWAY_DISABLED=1` to make the worker a no-op.
 */
const startGateway: ModuleCli = {
  command: 'start-gateway',
  async run(rest: string[]) {
    const args = parseArgs(rest)
    const tenantId = args.tenant ?? args.tenantId ?? args.t
    const refreshSeconds = Number.isFinite(Number(args.refresh ?? args.r))
      ? Math.max(0, Number(args.refresh ?? args.r))
      : 60

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

const channelDiscordCliCommands = [startGateway]

export default channelDiscordCliCommands
