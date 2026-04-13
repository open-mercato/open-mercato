import type { EntityManager } from '@mikro-orm/postgresql'
import { getGatewayAdapter, type WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'
import type { IntegrationLogService } from '../../integrations/lib/log-service'
import type { PaymentGatewayService } from './gateway-service'
import { claimWebhookProcessing, releaseWebhookClaim } from './webhook-utils'

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
  // Scope MUST come from the trusted route layer (derived from a verified GatewayTransaction).
  // Never fall back to attacker-controlled metadata on `event.data.metadata` — that was the
  // vector that allowed forged mock webhooks to mutate another tenant's payment state.
  const scopedPayload = payload.scope ?? null
  if (!scopedPayload) return

  let transaction = payload.transactionId
    ? await paymentGatewayService.findTransaction(payload.transactionId, scopedPayload)
    : null

  if (!transaction) {
    const sessionId = readSessionIdFromEvent(event)
    if (sessionId) {
      transaction = await paymentGatewayService.findTransactionBySessionId(sessionId, scopedPayload, providerKey)
    }
  }
  if (!transaction) return

  const scope = { organizationId: transaction.organizationId, tenantId: transaction.tenantId }
  const claimed = await claimWebhookProcessing(em, event.idempotencyKey, providerKey, scope, event.eventType)
  if (!claimed) {
    await writeTransactionLog(integrationLogService, providerKey, scope, transaction.id, 'info', 'Duplicate payment gateway webhook skipped', {
      eventType: event.eventType,
      idempotencyKey: event.idempotencyKey,
    })
    return
  }

  try {
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
    }, scope)

    await writeTransactionLog(integrationLogService, providerKey, scope, transaction.id, 'info', 'Payment gateway webhook processed', {
      eventType: event.eventType,
      unifiedStatus,
    })
  } catch (error: unknown) {
    await releaseWebhookClaim(em, event.idempotencyKey, providerKey, scope)
    throw error
  }
}
