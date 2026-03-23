import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutTransaction } from '../data/entities'

export const CHECKOUT_EXPIRY_QUEUE = 'checkout-transaction-expiry'

const EXPIRY_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 hours

export type CheckoutExpiryJob = {
  batchSize?: number
}

export const metadata: WorkerMeta = {
  queue: CHECKOUT_EXPIRY_QUEUE,
  id: 'checkout:transaction-expiry',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<CheckoutExpiryJob>, ctx: HandlerContext): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const commandBus = ctx.resolve('commandBus') as CommandBus
  const batchSize = job.payload?.batchSize ?? 100
  const cutoff = new Date(Date.now() - EXPIRY_TIMEOUT_MS)

  const staleTransactions = await findWithDecryption(
    em,
    CheckoutTransaction,
    {
      status: 'processing',
      createdAt: { $lt: cutoff },
    },
    { limit: batchSize, orderBy: { createdAt: 'ASC' } },
  )

  for (const transaction of staleTransactions) {
    try {
      const commandCtx: CommandRuntimeContext = {
        container: { resolve: ctx.resolve } as unknown as CommandRuntimeContext['container'],
        auth: null,
        organizationScope: null,
        selectedOrganizationId: transaction.organizationId,
        organizationIds: [transaction.organizationId],
      }
      await commandBus.execute('checkout.transaction.updateStatus', {
        input: {
          id: transaction.id,
          status: 'expired',
          paymentStatus: 'expired',
          organizationId: transaction.organizationId,
          tenantId: transaction.tenantId,
        },
        ctx: commandCtx,
      })
    } catch (error) {
      console.error('[checkout:transaction-expiry] Failed to expire transaction', transaction.id, error)
    }
  }
}
