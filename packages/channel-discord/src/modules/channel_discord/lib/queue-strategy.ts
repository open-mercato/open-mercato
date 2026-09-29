import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('channel_discord').child({ component: 'cli' })

/**
 * Refuse to start the gateway when inbound messages cannot possibly be delivered.
 *
 * `start-gateway` is a standalone process that runs a worker for the
 * `channel_discord_gateway` queue only, while the bridge enqueues received
 * messages into `communication-channels-inbound` / `-reactions`, whose workers
 * live in the app server process. Under the DEFAULT `QUEUE_STRATEGY=local` the
 * queue is in-process, so those jobs never cross the process boundary: they are
 * dropped with no error, no log, no retry and no `failed` entry, while the
 * channel keeps reporting `Connected`. Failing loudly at startup is the only
 * honest option — the alternative looks like it works.
 *
 * Lives outside `cli.ts` so it stays unit-testable without pulling the DI
 * container graph into the test.
 */
export function assertInboundDeliverable(queueStrategy: string | undefined): void {
  if (queueStrategy === 'async') return
  const message =
    'channel_discord start-gateway requires QUEUE_STRATEGY=async (with Redis configured). ' +
    'Under the default in-process queue strategy the gateway cannot hand inbound messages to the ' +
    'communication-channels workers running in the app server process — they would be silently dropped. ' +
    'Set QUEUE_STRATEGY=async and point the queue at Redis, then start this command again.'
  logger.error(message, { queueStrategy: queueStrategy ?? 'local (default)' })
  throw new Error(`[internal] ${message}`)
}
