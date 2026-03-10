import type { EntityManager } from '@mikro-orm/postgresql'
import { getGatewayAdapter, type WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'
import type { IntegrationLogService } from '../../integrations/lib/log-service'
import type { PaymentGatewayService } from './gateway-service'
import { checkWebhookIdempotency, markWebhookProcessed } from './webhook-utils'

export type PaymentGatewayWebhookJobPayload = {
  providerKey: string
  event: WebhookEvent
  transactionId?: string | null
  scope?: {
    organizationId: string
    tenantId: string
  } | null
}

type PaymentGatewayWebhookProcessorDeps = {
  em: EntityManager
  paymentGatewayService: PaymentGatewayService
  integrationLogService: IntegrationLogService
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

export async function processPaymentGatewayWebhookJob(
  deps: PaymentGatewayWebhookProcessorDeps,
  payload: PaymentGatewayWebhookJobPayload,
): Promise<void> {
  const { em, paymentGatewayService, integrationLogService } = deps
  const { providerKey, event } = payload

  let transaction = payload.transactionId
    ? await paymentGatewayService.findTransaction(payload.transactionId)
    : null

  if (!transaction) {
    const sessionId = readSessionIdFromEvent(event)
    if (sessionId) {
      transaction = await paymentGatewayService.findTransactionBySessionId(sessionId, providerKey)
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

  await paymentGatewayService.syncTransactionStatus(transaction.id, {
    unifiedStatus,
    providerStatus: event.eventType,
    providerData: event.data,
    webhookEvent: {
      eventType: event.eventType,
      idempotencyKey: event.idempotencyKey,
      processed: true,
    },
  })

  await markWebhookProcessed(em, event.idempotencyKey, providerKey, event.eventType, scope)
  await writeTransactionLog(integrationLogService, providerKey, scope, transaction.id, 'info', 'Payment gateway webhook processed', {
    eventType: event.eventType,
    unifiedStatus,
  })
}
