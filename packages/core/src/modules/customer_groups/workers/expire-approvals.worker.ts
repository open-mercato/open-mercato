import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { expirePendingApprovals } from '../lib/expireApprovals'

// Release 5 Phase 4 (D-R5-27, §11). Thin wrapper around `lib/expireApprovals.ts`, same
// shape as `availability/workers/reservation-expiry.worker.ts` and
// `customer_groups/workers/credit-exposure-audit.ts`'s own sibling jobs in this module.
// Scheduled hourly, per tenant, from `setup.ts`'s `seedDefaults`.

const logger = createLogger('customer_groups').child({ component: 'expire-approvals-worker' })

export type ExpireApprovalsTickPayload = {
  scope?: { tenantId?: string | null }
  tenantId?: string | null
}

export const metadata: WorkerMeta = {
  queue: 'customer_groups.expire_approvals',
  id: 'customer_groups:expire-approvals',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<ExpireApprovalsTickPayload>, ctx: HandlerContext): Promise<void> {
  const raw = (job?.payload ?? {}) as ExpireApprovalsTickPayload
  const tenantId = raw.scope?.tenantId ?? raw.tenantId ?? null
  if (!tenantId) {
    logger.warn('customer_groups:expire-approvals skipping tick — payload has no tenantId', { payload: raw })
    return
  }

  try {
    const result = await expirePendingApprovals(ctx, { tenantId })
    if (result.expiredCount > 0) {
      logger.info('customer_groups:expire-approvals expired approvals', { tenantId, expiredCount: result.expiredCount })
    }
  } catch (error) {
    logger.error('customer_groups:expire-approvals tick failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
