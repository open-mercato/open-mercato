import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { PUSH_STUCK_RECLAIM_QUEUE } from '../lib/queue'
import { reclaimStuckPushDeliveries } from '../lib/push-reaper'
import { checkPushReceipts } from '../lib/push-receipt-reaper'

const logger = createLogger('push_notifications')

/**
 * Scheduler tick payload. Fired by the `@open-mercato/scheduler` interval entry registered in
 * setup.ts (`push_notifications:reclaim-stuck`). The scheduler adds `tenantId` at the top level of the
 * enqueued payload on top of the configured `targetPayload`, so accept either shape.
 */
export type ReclaimStuckTickPayload = {
  scope?: { tenantId?: string | null }
  tenantId?: string | null
}

export const metadata: WorkerMeta = {
  queue: PUSH_STUCK_RECLAIM_QUEUE,
  id: 'push_notifications:reclaim-stuck',
  concurrency: 1, // single-flight per tenant tick — the atomic claim guards overlaps anyway
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: QueuedJob<ReclaimStuckTickPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const raw = (job?.payload ?? {}) as ReclaimStuckTickPayload
  const tenantId = raw.scope?.tenantId ?? raw.tenantId ?? null
  if (!tenantId) {
    logger.warn('reclaim-stuck skipping tick — payload has no tenantId', { payload: raw })
    return
  }

  const em = (ctx.resolve('em') as EntityManager).fork()
  try {
    const result = await reclaimStuckPushDeliveries(em, { tenantId })
    if (result.reEnqueued > 0 || result.expired > 0) {
      logger.info('reclaim-stuck swept stuck delivery rows', {
        tenantId,
        reEnqueued: result.reEnqueued,
        expired: result.expired,
      })
    }
  } catch (error) {
    logger.error('reclaim-stuck sweep failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  // Piggyback the Expo async-receipt hygiene pass on the same per-tenant tick (no separate scheduler
  // entry). Best-effort and isolated on its own EM fork: a receipt-check failure logs and returns, so it
  // never fails/retries the stuck-row reclaim above nor the tick itself.
  try {
    const receiptEm = (ctx.resolve('em') as EntityManager).fork()
    const receipts = await checkPushReceipts(receiptEm, { tenantId }, ctx.resolve)
    if (receipts.unregistered > 0) {
      logger.info('reclaim-stuck pruned devices from async push receipts', {
        tenantId,
        unregistered: receipts.unregistered,
        checked: receipts.checked,
      })
    }
  } catch (error) {
    logger.error('reclaim-stuck receipt sweep failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
