import type { EntityManager } from '@mikro-orm/postgresql'
import { getGatewayAdapter, type WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { IntegrationLogService } from '../../integrations/lib/log-service'
import type { PaymentGatewayService } from '../lib/gateway-service'
import { checkWebhookIdempotency, markWebhookProcessed } from '../lib/webhook-utils'

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
  queue: 'payment-gateways-webhook',
  id: 'payment-gateways:webhook-processor',
  concurrency: 5,
}

function readSessionIdFromEvent(event: WebhookEvent): string | null {
  const id = event.data.id
  if (typeof id === 'string' && id.trim().length > 0) return id.trim()
  const paymentIntent = event.data.payment_intent
  if (typeof paymentIntent === 'string' && paymentIntent.trim().length > 0) return paymentIntent.trim()
  return null
}

async function writeTransactionLog(
  integrationLogService: IntegrationLogService,
  providerKey: string,
  scope: { organizationId: string; tenantId: string },
  transactionId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  payload?: Record<string, unknown>,
) {
  await integrationLogService.write({
    integrationId: `gateway_${providerKey}`,
    scopeEntityType: 'payment_transaction',
    scopeEntityId: transactionId,
    level,
    message,
    payload: payload ?? null,
  }, scope)
}

export default async function handle(job: QueuedJob<WebhookJobPayload>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const service = ctx.resolve<PaymentGatewayService>('paymentGatewayService')
  const integrationLogService = ctx.resolve<IntegrationLogService>('integrationLogService')
  const { providerKey, event } = job.payload

  let transaction = job.payload.transactionId
    ? await service.findTransaction(job.payload.transactionId)
    : null

  if (!transaction) {
    const sessionId = readSessionIdFromEvent(event)
    if (sessionId) {
      transaction = await service.findTransactionBySessionId(sessionId, providerKey)
    }
  }
  if (!transaction) return

  const scope = { organizationId: transaction.organizationId, tenantId: transaction.tenantId }
  const duplicate = await checkWebhookIdempotency(em, event.idempotencyKey, providerKey, scope.organizationId)
  if (duplicate) {
    await writeTransactionLog(integrationLogService, providerKey, scope, transaction.id, 'info', 'Duplicate payment gateway webhook skipped', {
      eventType: event.eventType,
      idempotencyKey: event.idempotencyKey,
    })
    return
  }

  const adapter = getGatewayAdapter(providerKey)
  if (!adapter) {
    await writeTransactionLog(integrationLogService, providerKey, scope, transaction.id, 'warn', 'Missing payment gateway adapter for webhook event', {
      providerKey,
      eventType: event.eventType,
    })
    return
  }

  const providerStatus = typeof event.data.status === 'string' ? event.data.status : ''
  const unifiedStatus = adapter.mapStatus(providerStatus, event.eventType)
  await writeTransactionLog(integrationLogService, providerKey, scope, transaction.id, 'info', 'Payment gateway webhook received', {
      eventType: event.eventType,
      providerStatus,
      unifiedStatus,
  })

  if (unifiedStatus !== 'unknown') {
    await service.syncTransactionStatus(transaction.id, {
      unifiedStatus,
      providerStatus: event.eventType,
      providerData: event.data,
      webhookEvent: {
        eventType: event.eventType,
        idempotencyKey: event.idempotencyKey,
        processed: true,
      },
    })
  } else {
    await service.syncTransactionStatus(transaction.id, {
      unifiedStatus,
      providerStatus: event.eventType,
      providerData: event.data,
      webhookEvent: {
        eventType: event.eventType,
        idempotencyKey: event.idempotencyKey,
        processed: true,
      },
    })
  }

  await markWebhookProcessed(em, event.idempotencyKey, providerKey, event.eventType, scope)
  await writeTransactionLog(integrationLogService, providerKey, scope, transaction.id, 'info', 'Payment gateway webhook processed', {
    eventType: event.eventType,
    unifiedStatus,
  })
}
