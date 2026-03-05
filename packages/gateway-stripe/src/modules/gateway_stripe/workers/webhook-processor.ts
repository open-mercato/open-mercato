import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { checkWebhookIdempotency, markWebhookProcessed } from '@open-mercato/core/modules/payment_gateways/lib/webhook-utils'
import { mapWebhookEventToStatus, mapStripeStatus } from '../lib/status-map'

type WebhookJobPayload = {
  providerKey: string
  event: WebhookEvent
  transactionId?: string | null
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: 'stripe-webhook',
  id: 'gateway-stripe:webhook-processor',
  concurrency: 5,
}

function readSessionIdFromEvent(event: WebhookEvent): string | null {
  const id = event.data.id
  if (typeof id === 'string' && id.trim().length > 0) return id.trim()
  const paymentIntent = event.data.payment_intent
  if (typeof paymentIntent === 'string' && paymentIntent.trim().length > 0) return paymentIntent.trim()
  return null
}

export default async function handle(job: QueuedJob<WebhookJobPayload>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const paymentGatewayService = ctx.resolve<PaymentGatewayService>('paymentGatewayService')
  const integrationLogService = ctx.resolve<IntegrationLogService>('integrationLogService')
  const event = job.payload.event

  let transaction = job.payload.transactionId
    ? await paymentGatewayService.findTransaction(job.payload.transactionId)
    : null
  if (!transaction) {
    const sessionId = readSessionIdFromEvent(event)
    if (!sessionId) return
    transaction = await paymentGatewayService.findTransactionBySessionId(sessionId, 'stripe')
  }
  if (!transaction) return

  const scope = { organizationId: transaction.organizationId, tenantId: transaction.tenantId }
  const log = integrationLogService.scoped('gateway_stripe', scope)
  const duplicate = await checkWebhookIdempotency(em, event.idempotencyKey, 'stripe', scope.organizationId)
  if (duplicate) {
    await log.info('Duplicate Stripe webhook skipped', {
      eventType: event.eventType,
      idempotencyKey: event.idempotencyKey,
      transactionId: transaction.id,
    })
    return
  }

  const eventStatus = mapWebhookEventToStatus(event.eventType)
  const providerStatus = typeof event.data.status === 'string' ? event.data.status : ''
  const unifiedStatus = eventStatus ?? mapStripeStatus(providerStatus)

  if (unifiedStatus !== 'unknown') {
    await paymentGatewayService.syncTransactionStatus(transaction.id, {
      unifiedStatus,
      providerStatus: event.eventType,
      providerData: event.data,
    })
  }

  await markWebhookProcessed(em, event.idempotencyKey, 'stripe', event.eventType, scope)
  await log.info('Stripe webhook processed', {
    eventType: event.eventType,
    transactionId: transaction.id,
    unifiedStatus,
  })
}
