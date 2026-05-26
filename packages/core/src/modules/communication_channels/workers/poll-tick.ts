import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '../lib/queue'
import type { PollChannelJobPayload } from './poll-channel'

/**
 * Scheduler tick payload. Fired by the `@open-mercato/scheduler` cron entry
 * registered in the hub's `setup.ts` (`communication_channels:poll-tick` schedule).
 */
export type PollTickPayload = {
  scope: {
    tenantId: string
    organizationId: string | null
  }
}

const POLL_ENUMERATION_CAP = Math.max(
  1,
  Number.parseInt(process.env.COMMUNICATION_CHANNELS_POLL_ENUMERATION_CAP ?? '500', 10) || 500,
)

export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.pollTick,
  id: 'communication_channels:poll-tick',
  concurrency: 1, // single-flight per tenant — one tick at a time
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Enumerate channels due for polling and enqueue per-channel jobs.
 *
 * Per email integration spec § Hub Deltas → Delta 6:
 *   SELECT id FROM communication_channels
 *   WHERE is_active = true
 *     AND deleted_at IS NULL
 *     AND status = 'connected'
 *     AND poll_interval_seconds IS NOT NULL
 *     AND (last_polled_at IS NULL
 *          OR last_polled_at + poll_interval_seconds * '1 sec' <= NOW())
 *   ORDER BY last_polled_at NULLS FIRST
 *   LIMIT 500
 *
 * Implementation note: MikroORM's QueryBuilder is the canonical entry point;
 * the raw SQL above is the conceptual query. We use the entity-level filter to
 * keep things portable and let MikroORM compile it.
 */
export default async function handle(
  job: QueuedJob<PollTickPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const { scope } = job.payload
  const em = (ctx.resolve('em') as EntityManager).fork()

  const now = new Date()
  // Find candidate channels — we enumerate active+connected channels and filter
  // due-ness in JS to avoid casting interval arithmetic in SQL across DB engines.
  const candidates = await findWithDecryption(
    em,
    CommunicationChannel,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? null,
      isActive: true,
      deletedAt: null,
      status: 'connected',
      pollIntervalSeconds: { $ne: null } as any,
    } as any,
    {
      limit: POLL_ENUMERATION_CAP,
      orderBy: { lastPolledAt: 'asc' as any },
    },
    scope,
  )

  const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.poll)
  let enqueued = 0
  for (const channel of candidates as CommunicationChannel[]) {
    const intervalSeconds = channel.pollIntervalSeconds
    if (!intervalSeconds || intervalSeconds <= 0) continue
    if (!isDue(channel.lastPolledAt ?? null, intervalSeconds, now)) continue
    const payload: PollChannelJobPayload = {
      channelId: channel.id,
      scope: {
        tenantId: channel.tenantId,
        organizationId: channel.organizationId ?? scope.organizationId ?? null,
      },
      attempt: 1,
    }
    await queue.enqueue(payload as unknown as Record<string, unknown>)
    enqueued += 1
  }

  if (enqueued > 0) {
    console.log(
      `[communication_channels:poll-tick] enqueued ${enqueued} channel poll job(s) for tenant ${scope.tenantId}`,
    )
  }
}

function isDue(lastPolledAt: Date | null, intervalSeconds: number, now: Date): boolean {
  if (!lastPolledAt) return true
  const dueAt = new Date(lastPolledAt.getTime() + intervalSeconds * 1000)
  return now >= dueAt
}
