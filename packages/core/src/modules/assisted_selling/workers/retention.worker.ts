import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { sweepRetention } from '../lib/sweepers'

// Step 6.1 (§5.10, S7 gap-fill). Thin wrapper around `lib/sweepers.ts#sweepRetention`, same
// shape as `idle-close.worker.ts` right above it. Scheduled per organization from
// `setup.ts`'s `seedDefaults`.

const logger = createLogger('assisted_selling').child({ component: 'retention-worker' })

export type AssistedSellingRetentionTickPayload = {
  scope?: { tenantId?: string | null; organizationId?: string | null }
}

export const metadata: WorkerMeta = {
  queue: 'assisted_selling.retention',
  id: 'assisted_selling:retention',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<AssistedSellingRetentionTickPayload>, ctx: HandlerContext): Promise<void> {
  const raw = (job?.payload ?? {}) as AssistedSellingRetentionTickPayload
  const tenantId = raw.scope?.tenantId ?? null
  const organizationId = raw.scope?.organizationId ?? null
  if (!tenantId || !organizationId) {
    logger.warn('assisted_selling:retention skipping tick — payload has no tenantId/organizationId', { payload: raw })
    return
  }

  const em = (ctx.resolve('em') as EntityManager).fork()
  try {
    const result = await sweepRetention(em, { tenantId, organizationId })
    if (result.erasedCount > 0) {
      logger.info('assisted_selling:retention erased threads', { tenantId, organizationId, erasedCount: result.erasedCount })
    }
  } catch (error) {
    logger.error('assisted_selling:retention tick failed', {
      tenantId,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
