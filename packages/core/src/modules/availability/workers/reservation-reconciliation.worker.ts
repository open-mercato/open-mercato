import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AVAILABILITY_RECONCILE_RESERVATIONS_QUEUE } from '../lib/queues'
import { reconcileAvailabilityReservations } from '../lib/reservationSweep'

// Step 2.3 (A12, §10). Thin wrapper around `lib/reservationSweep.ts`, same shape as
// `availability:expire-reservations`'s own worker. Scheduled via `lib/scheduling.ts`'s
// `registerAvailabilityReservationSweeperSchedules`.

const logger = createLogger('availability').child({ component: 'reservation-reconciliation-worker' })

/** See `reservation-expiry.worker.ts`'s `ReservationExpiryTickPayload` doc comment — identical shape. */
export type ReservationReconciliationTickPayload = {
  scope?: { tenantId?: string | null }
  tenantId?: string | null
}

export const metadata: WorkerMeta = {
  queue: AVAILABILITY_RECONCILE_RESERVATIONS_QUEUE,
  id: 'availability:reconcile-reservations',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: QueuedJob<ReservationReconciliationTickPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const raw = (job?.payload ?? {}) as ReservationReconciliationTickPayload
  const tenantId = raw.scope?.tenantId ?? raw.tenantId ?? null
  if (!tenantId) {
    logger.warn('availability:reconcile-reservations skipping tick — payload has no tenantId', { payload: raw })
    return
  }

  try {
    const result = await reconcileAvailabilityReservations(ctx, { tenantId })
    const total = result.releasedHolds + result.orphanWmsReleased + result.convertedHolds
    if (total > 0) {
      logger.warn('availability:reconcile-reservations repaired drift', { tenantId, ...result })
    }
  } catch (error) {
    logger.error('availability:reconcile-reservations tick failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
