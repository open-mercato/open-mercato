import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerUserEmailVerification,
  CustomerUserPasswordReset,
  CustomerUserInvitation,
} from '@open-mercato/core/modules/customer_accounts/data/entities'

type CleanupPayload = {
  batchSize?: number
}

export const metadata: WorkerMeta = {
  queue: 'customer-accounts-cleanup-tokens',
  id: 'customer_accounts:cleanup-expired-tokens',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<CleanupPayload>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const now = new Date()

  // Cleanup expired email verifications
  await em.nativeDelete(CustomerUserEmailVerification, {
    $or: [
      { expiresAt: { $lt: now }, usedAt: null },
      { usedAt: { $ne: null } },
    ],
  } as any)

  // Cleanup expired password resets
  await em.nativeDelete(CustomerUserPasswordReset, {
    $or: [
      { expiresAt: { $lt: now }, usedAt: null },
      { usedAt: { $ne: null } },
    ],
  } as any)

  // Cleanup expired/accepted/cancelled invitations
  await em.nativeDelete(CustomerUserInvitation, {
    $or: [
      { expiresAt: { $lt: now }, acceptedAt: null, cancelledAt: null },
      { acceptedAt: { $ne: null } },
      { cancelledAt: { $ne: null } },
    ],
  } as any)
}
