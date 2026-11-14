import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { runCustomerMaintenanceTenant } from '../database'
import { isDatabaseRuntimeEnabled } from '@open-mercato/shared/lib/db/runtime'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerUserEmailVerification,
  CustomerUserPasswordReset,
  CustomerUserInvitation,
} from '@open-mercato/core/modules/customer_accounts/data/entities'

export const metadata: WorkerMeta = {
  queue: 'customer-accounts-cleanup-tokens',
  id: 'customer_accounts:cleanup-expired-tokens',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const now = new Date()

  const cleanup = async (scopedEm: EntityManager, tenantId?: string) => {
    // Cleanup expired email verifications
    await scopedEm.nativeDelete(CustomerUserEmailVerification, {
      ...(tenantId ? { tenantId } : {}),
      $or: [
        { expiresAt: { $lt: now }, usedAt: null },
        { usedAt: { $ne: null } },
      ],
    })

    // Cleanup expired password resets
    await scopedEm.nativeDelete(CustomerUserPasswordReset, {
      ...(tenantId ? { tenantId } : {}),
      $or: [
        { expiresAt: { $lt: now }, usedAt: null },
        { usedAt: { $ne: null } },
      ],
    })

    // Cleanup expired/accepted/cancelled invitations
    await scopedEm.nativeDelete(CustomerUserInvitation, {
      ...(tenantId ? { tenantId } : {}),
      $or: [
        { expiresAt: { $lt: now }, acceptedAt: null, cancelledAt: null },
        { acceptedAt: { $ne: null } },
        { cancelledAt: { $ne: null } },
      ],
    })
  }
  if (!isDatabaseRuntimeEnabled()) return cleanup(em)
  const tenants: unknown = await em.getConnection().execute("select distinct tenant_id from customer_user_email_verifications union select distinct tenant_id from customer_user_password_resets union select distinct tenant_id from customer_user_invitations")
  if (!Array.isArray(tenants)) throw new Error('[internal] Invalid customer cleanup tenant discovery result')
  for (const row of tenants as Array<{ tenant_id: string }>) {
    try {
      await runCustomerMaintenanceTenant({ tenantId: row.tenant_id }, ctx, (container) =>
        cleanup(container.resolve<EntityManager>('em'), row.tenant_id))
    } catch {
      getTelemetryRuntime()?.reportError(new Error('[internal] Customer tokens cleanup tenant failed binding validation or execution'), {
        module: 'customer_accounts',
        code: 'customer_accounts.tokens_cleanup_tenant_failed',
      })
    }
  }
}
