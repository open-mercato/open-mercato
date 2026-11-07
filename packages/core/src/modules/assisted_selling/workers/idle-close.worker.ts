import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { sweepIdleThreads } from '../lib/sweepers'

// Step 6.1 (§5.10, S7 gap-fill). Thin wrapper around `lib/sweepers.ts#sweepIdleThreads`,
// same shape as `customer_groups/workers/expire-approvals.worker.ts` and its own sibling
// `retention.worker.ts` in this module. Scheduled per organization from `setup.ts`'s
// `seedDefaults`, same granularity `customer_groups`'s `credit-exposure-audit` schedule
// already uses (both jobs join against organization-scoped settings rows).

const logger = createLogger('assisted_selling').child({ component: 'idle-close-worker' })

export type AssistedSellingIdleCloseTickPayload = {
  scope?: { tenantId?: string | null; organizationId?: string | null }
}

export const metadata: WorkerMeta = {
  queue: 'assisted_selling.idle_close',
  id: 'assisted_selling:idle-close',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<AssistedSellingIdleCloseTickPayload>, ctx: HandlerContext): Promise<void> {
  const raw = (job?.payload ?? {}) as AssistedSellingIdleCloseTickPayload
  const tenantId = raw.scope?.tenantId ?? null
  const organizationId = raw.scope?.organizationId ?? null
  if (!tenantId || !organizationId) {
    logger.warn('assisted_selling:idle-close skipping tick — payload has no tenantId/organizationId', { payload: raw })
    return
  }

  const em = (ctx.resolve('em') as EntityManager).fork()
  try {
    const result = await sweepIdleThreads(em, { tenantId, organizationId })
    if (result.closedCount > 0) {
      logger.info('assisted_selling:idle-close closed idle threads', { tenantId, organizationId, closedCount: result.closedCount })
    }
  } catch (error) {
    logger.error('assisted_selling:idle-close tick failed', {
      tenantId,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
