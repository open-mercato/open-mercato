import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AVAILABILITY_EXPIRE_RESERVATIONS_QUEUE } from '../lib/queues'
import { expireAvailabilityReservations } from '../lib/reservationSweep'

// Step 2.3 (A11, §10). Thin wrapper around `lib/reservationSweep.ts`, same shape as
// `cart`'s own sweeper workers (e.g. `cart/workers/expire.worker.ts`). Scheduled via
// `lib/scheduling.ts`'s `registerAvailabilityReservationSweeperSchedules`, called from both
// `setup.ts`'s `seedDefaults` (new tenants) and the
// `availability.register-reservation-sweep-schedules` upgrade action
// (`configs/lib/upgrade-actions.ts`, existing tenants).

const logger = createLogger('availability').child({ component: 'reservation-expiry-worker' })

/**
 * Scheduler tick payload. The scheduler adds `tenantId` at the top level of the enqueued
 * payload on top of the configured `targetPayload`, so accept either shape — mirrors
 * `cart/workers/expire.worker.ts#CartSweepTickPayload`.
 */
export type ReservationExpiryTickPayload = {
  scope?: { tenantId?: string | null }
  tenantId?: string | null
}

export const metadata: WorkerMeta = {
  queue: AVAILABILITY_EXPIRE_RESERVATIONS_QUEUE,
  id: 'availability:expire-reservations',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: QueuedJob<ReservationExpiryTickPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const raw = (job?.payload ?? {}) as ReservationExpiryTickPayload
  const tenantId = raw.scope?.tenantId ?? raw.tenantId ?? null
  if (!tenantId) {
    logger.warn('availability:expire-reservations skipping tick — payload has no tenantId', { payload: raw })
    return
  }

  try {
    const result = await expireAvailabilityReservations(ctx, { tenantId })
    if (result.expiredCount > 0) {
      logger.info('availability:expire-reservations expired holds', { tenantId, expiredCount: result.expiredCount })
    }
  } catch (error) {
    logger.error('availability:expire-reservations tick failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
