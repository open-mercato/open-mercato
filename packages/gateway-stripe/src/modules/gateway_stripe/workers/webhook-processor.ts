import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { claimWebhookProcessing, releaseWebhookClaim } from '@open-mercato/core/modules/payment_gateways/lib/webhook-utils'
import { mapWebhookEventToStatus, mapStripeStatus } from '../lib/status-map'

type WebhookJobPayload = {
  providerKey: string
  event: WebhookEvent
  transactionId?: string | null
  scope?: {
    organizationId: string
    tenantId: string
  } | null
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

function readScopeFromEvent(event: WebhookEvent): { organizationId: string; tenantId: string } | null {
  const metadata = event.data.metadata
  if (!metadata || typeof metadata !== 'object') return null

  const metadataRecord = metadata as Record<string, unknown>
  const organizationId = typeof metadataRecord.organizationId === 'string'
    ? metadataRecord.organizationId.trim()
    : ''
  const tenantId = typeof metadataRecord.tenantId === 'string'
    ? metadataRecord.tenantId.trim()
    : ''

  if (!organizationId || !tenantId) return null
  return { organizationId, tenantId }
}

export default async function handle(job: QueuedJob<WebhookJobPayload>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const paymentGatewayService = ctx.resolve<PaymentGatewayService>('paymentGatewayService')
  const integrationLogService = ctx.resolve<IntegrationLogService>('integrationLogService')
  const event = job.payload.event
  const scope = job.payload.scope ?? readScopeFromEvent(event)

  try {
    let transaction = job.payload.transactionId && scope
      ? await paymentGatewayService.findTransaction(job.payload.transactionId, scope)
      : null
    if (!transaction) {
      const sessionId = readSessionIdFromEvent(event)
      if (!sessionId || !scope) return
      transaction = await paymentGatewayService.findTransactionBySessionId(sessionId, scope, 'stripe')
    }
    if (!transaction) return

    const transactionScope = { organizationId: transaction.organizationId, tenantId: transaction.tenantId }
    const log = integrationLogService.scoped('gateway_stripe', transactionScope)
    const claimed = await claimWebhookProcessing(em, event.idempotencyKey, 'stripe', transactionScope, event.eventType)
    if (!claimed) {
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
      }, transactionScope)
    }

    await log.info('Stripe webhook processed', {
      eventType: event.eventType,
      transactionId: transaction.id,
      unifiedStatus,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Stripe webhook processing failed'
    if (scope) {
      await releaseWebhookClaim(em, event.idempotencyKey, 'stripe', scope)
      await integrationLogService.write({
        integrationId: 'gateway_stripe',
        level: 'error',
        message: 'Stripe webhook processing failed',
        code: 'stripe_webhook_processing_failed',
        payload: {
          error: message,
          eventType: event.eventType,
          transactionId: job.payload.transactionId ?? null,
        },
      }, scope)
    } else {
      console.error('[gateway-stripe:webhook-processor]', message, {
        eventType: event.eventType,
        transactionId: job.payload.transactionId ?? null,
      })
    }
    throw error
  }
}
