import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUserSession } from '@open-mercato/core/modules/customer_accounts/data/entities'

type CleanupPayload = {
  batchSize?: number
}

export const metadata: WorkerMeta = {
  queue: 'customer-accounts-cleanup-sessions',
  id: 'customer_accounts:cleanup-expired-sessions',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<CleanupPayload>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const batchSize = job.payload?.batchSize || 1000

  const deleted = await em.nativeDelete(CustomerUserSession, {
    $or: [
      { expiresAt: { $lt: new Date() } },
      { deletedAt: { $ne: null } },
    ],
  } as any)

  if (typeof deleted === 'number' && deleted > 0) {
    // Batch processed; if more remain, the scheduler will enqueue again
  }
}
