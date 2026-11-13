import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { runCustomerMaintenanceTenant } from '../database'
import { isDatabaseRuntimeEnabled } from '@open-mercato/shared/lib/db/runtime'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUserSession } from '@open-mercato/core/modules/customer_accounts/data/entities'

export const metadata: WorkerMeta = {
  queue: 'customer-accounts-cleanup-sessions',
  id: 'customer_accounts:cleanup-expired-sessions',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')

  const cleanup = async (scopedEm: EntityManager, tenantId?: string) => {
    const deleted = await scopedEm.nativeDelete(CustomerUserSession, {
      ...(tenantId ? { tenantId } : {}),
      $or: [
        { expiresAt: { $lt: new Date() } },
        { deletedAt: { $ne: null } },
      ],
    })

    if (typeof deleted === 'number' && deleted > 0) {
      // Batch processed; if more remain, the scheduler will enqueue again
    }
  }
  if (!isDatabaseRuntimeEnabled()) return cleanup(em)
  const tenants: unknown = await em.getConnection().execute("select distinct tenant_id from customer_user_sessions")
  if (!Array.isArray(tenants)) throw new Error('[internal] Invalid customer cleanup tenant discovery result')
  for (const row of tenants as Array<{ tenant_id: string }>) {
    try {
      await runCustomerMaintenanceTenant({ tenantId: row.tenant_id }, ctx, (container) =>
        cleanup(container.resolve<EntityManager>('em'), row.tenant_id))
    } catch {
      getTelemetryRuntime()?.reportError(new Error('[internal] Customer sessions cleanup tenant failed binding validation or execution'), {
        module: 'customer_accounts',
        code: 'customer_accounts.sessions_cleanup_tenant_failed',
      })
    }
  }
}
