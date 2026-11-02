import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { PROMOTIONS_CODE_RESERVATION_SWEEP_QUEUE } from '../lib/queues'
import { sweepExpiredCodeReservations } from '../services/code-reservation-sweeper'

// Step 6.5 (SPEC-055 rev A.6/X7). Thin wrapper around `services/code-reservation-sweeper.ts`,
// same shape as `cart`'s own four sweeper workers (e.g. `cart/workers/mark-abandoned.worker.ts`).
// Scheduled via `lib/scheduling.ts`'s `registerCodeReservationSweepSchedule`, called from both
// `setup.ts`'s `seedDefaults` (new tenants) and the `promotions.register-code-reservation-sweep-schedule`
// upgrade action (`configs/lib/upgrade-actions.ts`, existing tenants).

const logger = createLogger('promotions').child({ component: 'code-reservation-sweep-worker' })

/**
 * Scheduler tick payload. The scheduler adds `tenantId` at the top level of the enqueued
 * payload on top of the configured `targetPayload`, so accept either shape — mirrors
 * `cart/workers/mark-abandoned.worker.ts#CartSweepTickPayload`.
 */
export type CodeReservationSweepTickPayload = {
  scope?: { tenantId?: string | null }
  tenantId?: string | null
}

export const metadata: WorkerMeta = {
  queue: PROMOTIONS_CODE_RESERVATION_SWEEP_QUEUE,
  id: 'promotions:code-reservation-sweep',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: QueuedJob<CodeReservationSweepTickPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const raw = (job?.payload ?? {}) as CodeReservationSweepTickPayload
  const tenantId = raw.scope?.tenantId ?? raw.tenantId ?? null
  if (!tenantId) {
    logger.warn('promotions:code-reservation-sweep skipping tick — payload has no tenantId', { payload: raw })
    return
  }

  const em = (ctx.resolve('em') as EntityManager).fork()
  try {
    const result = await sweepExpiredCodeReservations(em, { tenantId })
    if (result.released > 0) {
      logger.info('promotions:code-reservation-sweep released lapsed reservations', {
        tenantId,
        released: result.released,
      })
    }
  } catch (error) {
    logger.error('promotions:code-reservation-sweep failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
