import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { IntegrationLogService } from '../../integrations/lib/log-service'
import type { PaymentGatewayService } from '../lib/gateway-service'

type PollerJobPayload = {
  scope?: {
    organizationId?: string
    tenantId?: string
    providerKey?: string
  }
  limit?: number
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: 'payment-gateways-status-poller',
  id: 'payment-gateways:status-poller',
  concurrency: 2,
}

export default async function handle(job: QueuedJob<PollerJobPayload>, ctx: HandlerContext): Promise<void> {
  const service = ctx.resolve<PaymentGatewayService>('paymentGatewayService')
  const integrationLogService = ctx.resolve<IntegrationLogService>('integrationLogService')
  const transactions = await service.listTransactionsForStatusPolling({
    organizationId: job.payload.scope?.organizationId,
    tenantId: job.payload.scope?.tenantId,
    providerKey: job.payload.scope?.providerKey,
    limit: job.payload.limit ?? 100,
  })

  for (const transaction of transactions) {
    try {
      await service.getPaymentStatus(transaction.id, {
        organizationId: transaction.organizationId,
        tenantId: transaction.tenantId,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown polling error'
      await integrationLogService.write({
        integrationId: `gateway_${transaction.providerKey}`,
        scopeEntityType: 'payment_transaction',
        scopeEntityId: transaction.id,
        level: 'error',
        // The cause belongs in the message, not only in `payload`: the payload is
        // the durable record and never leaves the database, so an operator paged by
        // the reported error would otherwise learn only that a gateway failed.
        message: `Payment status polling failed: ${message}`,
        code: 'payment_gateways.status_poll_failed',
        payload: {
          transactionId: transaction.id,
          message,
        },
      }, {
        organizationId: transaction.organizationId,
        tenantId: transaction.tenantId,
      })
    }
  }
}
