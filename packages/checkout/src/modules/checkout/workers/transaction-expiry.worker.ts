import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutTransaction } from '../data/entities'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('checkout').child({ component: 'transaction-expiry' })

export const CHECKOUT_EXPIRY_QUEUE = 'checkout-transaction-expiry'

const EXPIRY_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 hours

export type CheckoutExpiryJob = {
  batchSize?: number
  tenantId: string
  organizationId: string
}

export const metadata: WorkerMeta = {
  queue: CHECKOUT_EXPIRY_QUEUE,
  id: 'checkout:transaction-expiry',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

function buildCommandContext(ctx: HandlerContext, organizationId: string): CommandRuntimeContext {
  return {
    container: { resolve: ctx.resolve } as unknown as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
}

async function completeCapturedCheckoutTransaction(
  commandBus: CommandBus,
  ctx: HandlerContext,
  transaction: CheckoutTransaction,
): Promise<void> {
  await commandBus.execute('checkout.transaction.updateStatus', {
    input: {
      id: transaction.id,
      status: 'completed',
      paymentStatus: 'captured',
      gatewayTransactionId: transaction.gatewayTransactionId,
      organizationId: transaction.organizationId,
      tenantId: transaction.tenantId,
    },
    ctx: buildCommandContext(ctx, transaction.organizationId),
  })
}

export default async function handle(job: QueuedJob<CheckoutExpiryJob>, ctx: HandlerContext): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const commandBus = ctx.resolve('commandBus') as CommandBus
  const batchSize = job.payload?.batchSize ?? 100
  const cutoff = new Date(Date.now() - EXPIRY_TIMEOUT_MS)

  if (!job.payload?.tenantId || !job.payload?.organizationId) {
    throw new Error('[internal] tenantId and organizationId are required in CheckoutExpiryJob')
  }

  const { tenantId, organizationId } = job.payload

  const staleTransactions = await findWithDecryption(
    em,
    CheckoutTransaction,
    {
      status: 'processing',
      createdAt: { $lt: cutoff },
      tenantId,
      organizationId,
    },
    { limit: batchSize, orderBy: { createdAt: 'ASC' } },
    { tenantId, organizationId },
  )

  for (const transaction of staleTransactions) {
    try {
      if (transaction.gatewayTransactionId) {
        const paymentGatewayService = ctx.resolve<PaymentGatewayService>('paymentGatewayService')
        const scope = { organizationId: transaction.organizationId, tenantId: transaction.tenantId }
        const status = await paymentGatewayService.getPaymentStatus(transaction.gatewayTransactionId, scope)

        if (status.status === 'captured') {
          await completeCapturedCheckoutTransaction(commandBus, ctx, transaction)
          continue
        }
        if (status.status === 'partially_captured') {
          logger.warn('Gateway session has captured funds; checkout transaction remains processing', {
            transactionId: transaction.id,
            gatewayTransactionId: transaction.gatewayTransactionId,
          })
          continue
        }

        if (!['cancelled', 'failed', 'expired', 'refunded', 'partially_refunded'].includes(status.status)) {
          const cancellation = await paymentGatewayService.cancelPayment(
            transaction.gatewayTransactionId,
            'Checkout transaction expired',
            scope,
            `checkout-expiry-${job.id}-${transaction.id}`,
          )
          if (cancellation.status === 'captured') {
            await completeCapturedCheckoutTransaction(commandBus, ctx, transaction)
            continue
          }
          if (cancellation.status !== 'cancelled') {
            logger.warn('Gateway session was not confirmed cancelled; checkout transaction remains processing', {
              transactionId: transaction.id,
              gatewayTransactionId: transaction.gatewayTransactionId,
              gatewayStatus: cancellation.status,
            })
            continue
          }
        }
      }

      await commandBus.execute('checkout.transaction.updateStatus', {
        input: {
          id: transaction.id,
          status: 'expired',
          paymentStatus: 'expired',
          organizationId: transaction.organizationId,
          tenantId: transaction.tenantId,
        },
        ctx: buildCommandContext(ctx, transaction.organizationId),
      })
    } catch (error) {
      logger.error('Failed to expire transaction', { transactionId: transaction.id, err: error })
    }
  }
}
