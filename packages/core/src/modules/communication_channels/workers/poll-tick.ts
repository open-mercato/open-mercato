import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '../lib/queue'
import type { PollChannelJobPayload } from './poll-channel'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'poll-tick' })

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
  // The scheduler module (`@open-mercato/scheduler`) spreads the configured
  // `targetPayload` and then adds `tenantId` / `organizationId` at the TOP
  // level of the enqueued payload (see
  // packages/scheduler/.../execute-schedule.worker.ts). Our setup.ts originally
  // stored `{ scope: { tenantId, organizationId } }` under targetPayload, so
  // at runtime the payload looks like:
  //   { scope: { tenantId, organizationId }, tenantId, organizationId, _idempotencyKey }
  // Accept either path so the handler is robust to both how operators originally
  // configured the schedule (nested `scope`) and how the scheduler flattens it.
  const raw = (job?.payload ?? {}) as Partial<PollTickPayload> & {
    tenantId?: string | null
    organizationId?: string | null
  }
  const tenantId = raw.scope?.tenantId ?? raw.tenantId ?? null
  const organizationId =
    raw.scope?.organizationId ?? raw.organizationId ?? null
  if (!tenantId) {
    logger.warn(
      'skipping tick — payload has no tenantId',
    )
    return
  }
  const scope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()

  const now = new Date()
  // Find candidate channels — we enumerate two pools:
  //   (1) status='connected' channels due for their normal poll cycle.
  //   (2) Spec B § Auto-recovery sweep: status='error' channels whose
  //       `lastPolledAt` is older than OM_CHANNEL_AUTO_RECOVER_MINUTES
  //       (default 30 min). At most one retry per recovery window per
  //       channel — when we enqueue a recovery job below we bump that
  //       channel's `lastPolledAt` to `now` so it falls back under the
  //       cutoff and is NOT re-selected on the immediately-following ticks
  //       (poll-channel only advances `lastPolledAt` on a SUCCESSFUL poll,
  //       so without this a persistently-failing channel would re-enqueue
  //       every tick). On success `poll-channel` flips the status back to
  //       'connected' so the channel rejoins the normal pool.
  //
  // Due-ness for (1) is computed in JS to avoid cross-DB interval
  // arithmetic; the (2) cutoff is a single timestamp compare.
  const connectedCandidates = await findWithDecryption(
    em,
    CommunicationChannel,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? null,
      isActive: true,
      deletedAt: null,
      status: 'connected',
      pollIntervalSeconds: { $ne: null },
    },
    {
      limit: POLL_ENUMERATION_CAP,
      orderBy: { lastPolledAt: 'asc' },
    },
    scope,
  )

  const recoverMinutesRaw = Number.parseInt(
    process.env.OM_CHANNEL_AUTO_RECOVER_MINUTES ?? '',
    10,
  )
  // `0` is a valid override meaning "recover on the very next tick" (used by
  // TC-CHANNEL-EMAIL-027 and operators who want aggressive recovery). Only a
  // negative or non-numeric value falls back to the 30-minute default.
  const recoverMinutes =
    Number.isFinite(recoverMinutesRaw) && recoverMinutesRaw >= 0 ? recoverMinutesRaw : 30
  const recoverCutoff = new Date(now.getTime() - recoverMinutes * 60 * 1000)
  const errorCandidates = await findWithDecryption(
    em,
    CommunicationChannel,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? null,
      isActive: true,
      deletedAt: null,
      status: 'error',
      // Polling channels only. Push-only channels (Gmail) have
      // `pollIntervalSeconds = null` and are intentionally excluded: poll-channel
      // returns early for push providers, so their recovery is owner-driven
      // (re-register push / reconnect), not this poll-recovery sweep.
      pollIntervalSeconds: { $ne: null },
      // `lastPolledAt` advances only on a SUCCESSFUL poll (poll-channel does
      // not touch it in `handlePollError`). To keep recovery to one retry per
      // window — rather than re-enqueuing a persistently-failing channel every
      // tick — the recovery-enqueue loop below bumps `lastPolledAt` to `now`
      // when it schedules a recovery job, so the channel only re-enters this
      // pool after another `recoverMinutes` have elapsed.
      //
      // A channel that fails its FIRST poll (before any success) still has
      // `lastPolledAt = null`; a bare `$lt` would exclude it forever (SQL
      // `NULL < ts` is NULL, not true), stranding it in `error`. Include the
      // null case so never-polled error channels get their first recovery
      // attempt on the next tick (the enqueue bump below then throttles it).
      $or: [{ lastPolledAt: null }, { lastPolledAt: { $lt: recoverCutoff } }],
    },
    {
      limit: POLL_ENUMERATION_CAP,
      orderBy: { lastPolledAt: 'asc' },
    },
    scope,
  )

  const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.poll)
  let enqueued = 0
  let recovered = 0
  for (const channel of connectedCandidates as CommunicationChannel[]) {
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
  // Auto-recovery: at most one retry per recovery window per error-state
  // channel. We bump `lastPolledAt` to `now` as we enqueue so the same channel
  // drops back under `recoverCutoff` and is NOT re-selected on the next ticks
  // (poll-channel leaves `lastPolledAt` untouched on failure, so without this a
  // persistently-failing channel would be re-enqueued every tick).
  for (const channel of errorCandidates as CommunicationChannel[]) {
    const payload: PollChannelJobPayload = {
      channelId: channel.id,
      scope: {
        tenantId: channel.tenantId,
        organizationId: channel.organizationId ?? scope.organizationId ?? null,
      },
      attempt: 1,
    }
    await queue.enqueue(payload as unknown as Record<string, unknown>)
    channel.lastPolledAt = now
    recovered += 1
  }
  if (recovered > 0) await em.flush()

  if (enqueued > 0 || recovered > 0) {
    logger.info('enqueued poll jobs for tenant', { enqueued, recovered, tenantId: scope.tenantId })
  }
}

function isDue(lastPolledAt: Date | null, intervalSeconds: number, now: Date): boolean {
  if (!lastPolledAt) return true
  const dueAt = new Date(lastPolledAt.getTime() + intervalSeconds * 1000)
  return now >= dueAt
}
