import { z } from 'zod'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'

const logger = createLogger('gateway_tpay')

const MAX_LIMIT = 100

const uuidSchema = z.string().uuid()

const scopeSchema = z.object({
  organizationId: uuidSchema,
  tenantId: uuidSchema,
})

const limitSchema = z.number().int().min(1).max(MAX_LIMIT).catch(MAX_LIMIT)

type PollerJobPayload = {
  scope?: { organizationId?: unknown; tenantId?: unknown }
  organizationId?: unknown
  tenantId?: unknown
  limit?: unknown
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: 'gateway-tpay-status-poller',
  id: 'gateway_tpay:status-poller',
  concurrency: 2,
}

export default async function handle(job: QueuedJob<PollerJobPayload>, ctx: HandlerContext): Promise<void> {
  const payload = job.payload ?? {}
  const parsedScope = scopeSchema.safeParse({
    organizationId: payload.scope?.organizationId ?? payload.organizationId,
    tenantId: payload.scope?.tenantId ?? payload.tenantId,
  })
  if (!parsedScope.success) {
    logger.warn('Tpay reconciliation skipped: missing or invalid scope')
    return
  }
  const { organizationId, tenantId } = parsedScope.data
  const limit = payload.limit === undefined ? MAX_LIMIT : limitSchema.parse(payload.limit)

  const service = ctx.resolve<PaymentGatewayService>('paymentGatewayService')
  const transactions = await service.listTransactionsForStatusPolling({
    providerKey: 'tpay',
    organizationId,
    tenantId,
    limit,
  })

  let changed = 0
  let failed = 0
  for (const transaction of transactions) {
    const previousStatus = transaction.unifiedStatus
    try {
      const result = await service.getPaymentStatus(transaction.id, {
        organizationId: transaction.organizationId,
        tenantId: transaction.tenantId,
      })
      if (result.status !== previousStatus) changed += 1
    } catch (error: unknown) {
      failed += 1
      logger.warn('Tpay status poll failed', { transactionId: transaction.id })
      getTelemetryRuntime()?.reportError(error, { module: 'gateway_tpay', code: 'gateway_tpay.status_poll_failed' })
    }
  }

  logger.info('Tpay reconciliation run finished', {
    scanned: transactions.length,
    changed,
    failed,
    organizationId,
    tenantId,
  })
}
