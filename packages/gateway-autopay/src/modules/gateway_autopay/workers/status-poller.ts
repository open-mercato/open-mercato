import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import pollPaymentStatuses from '@open-mercato/core/modules/payment_gateways/workers/status-poller'
import { AUTOPAY_STATUS_POLLER_BATCH_LIMIT, AUTOPAY_STATUS_POLLER_QUEUE } from '../lib/status-poller-schedule'

const PROVIDER_KEY = 'autopay'

type ScheduledPollerPayload = {
  scope?: { tenantId?: string | null; organizationId?: string | null }
  limit?: number
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

const logger = createLogger('gateway_autopay')

export const metadata: WorkerMeta = {
  queue: AUTOPAY_STATUS_POLLER_QUEUE,
  id: 'gateway_autopay:status-poller',
  concurrency: 1,
}

/**
 * Narrows the generic payment-gateway status poller to Autopay transactions.
 * The scheduler injects the trusted tenant/organization scope into
 * `payload.scope`; the provider key is fixed here and never read from the job,
 * so a schedule payload cannot widen the poll to other providers.
 */
export default async function handle(
  job: QueuedJob<ScheduledPollerPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const tenantId = job.payload?.scope?.tenantId
  const organizationId = job.payload?.scope?.organizationId
  if (!tenantId || !organizationId) {
    logger.warn('Skipping Autopay status reconciliation without tenant scope')
    return
  }

  const limit = typeof job.payload?.limit === 'number' && job.payload.limit > 0
    ? Math.min(job.payload.limit, AUTOPAY_STATUS_POLLER_BATCH_LIMIT)
    : AUTOPAY_STATUS_POLLER_BATCH_LIMIT

  await pollPaymentStatuses(
    {
      ...job,
      payload: {
        scope: { tenantId, organizationId, providerKey: PROVIDER_KEY },
        limit,
      },
    },
    ctx,
  )
}
