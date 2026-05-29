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
    console.warn(
      '[communication_channels:poll-tick] skipping tick — payload has no tenantId',
      { payload: raw },
    )
    return
  }
  const scope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()

  const now = new Date()
  // Find candidate channels — we enumerate two pools:
  //   (1) status='connected' channels due for their normal poll cycle.
  //   (2) Spec B § Auto-recovery sweep: status='error' channels whose
  //       `lastFailureAt` is older than OM_CHANNEL_AUTO_RECOVER_MINUTES
  //       (default 30 min). One retry tick per sweep; on success
  //       `poll-channel` flips the status back to 'connected' so the
  //       channel rejoins the normal pool.
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
  const recoverMinutes =
    Number.isFinite(recoverMinutesRaw) && recoverMinutesRaw > 0 ? recoverMinutesRaw : 30
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
      pollIntervalSeconds: { $ne: null },
      // `lastPolledAt` advances only on a SUCCESSFUL poll (poll-channel does
      // not touch it in `handlePollError`), so for an error channel this gates
      // recovery on the age of the last success: once
      // `lastPolledAt < recoverCutoff` it re-enters the poll. A dedicated
      // `lastFailureAt` would let recovery back off from the failure instead.
      lastPolledAt: { $lt: recoverCutoff },
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
  // Auto-recovery: one retry per sweep cycle per error-state channel.
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
    recovered += 1
  }

  if (enqueued > 0 || recovered > 0) {
    console.log(
      `[communication_channels:poll-tick] enqueued ${enqueued} normal + ${recovered} auto-recover poll job(s) for tenant ${scope.tenantId}`,
    )
  }
}

function isDue(lastPolledAt: Date | null, intervalSeconds: number, now: Date): boolean {
  if (!lastPolledAt) return true
  const dueAt = new Date(lastPolledAt.getTime() + intervalSeconds * 1000)
  return now >= dueAt
}
