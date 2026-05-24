import type { EntityManager } from '@mikro-orm/postgresql'
import type { WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'
import type { IntegrationLogService } from '../../integrations/lib/log-service'
import { emitPaymentGatewayEvent } from '../events'
import { claimWebhookProcessing, releaseWebhookClaim } from './webhook-utils'

export type PaymentGatewaySubscriptionScope = {
  organizationId: string
  tenantId: string
  externalAccountId?: string | null
  subscriptionId?: string | null
  subjectEntityType?: string | null
  subjectEntityId?: string | null
}

export type PaymentGatewaySubscriptionWebhookJobPayload = {
  providerKey: string
  event: WebhookEvent
  scope: PaymentGatewaySubscriptionScope
  ref: {
    providerSubscriptionId?: string | null
    providerCustomerId?: string | null
    providerInvoiceId?: string | null
    providerChargeId?: string | null
  }
}

type Deps = {
  em: EntityManager
  integrationLogService?: IntegrationLogService
  eventBus?: {
    emitEvent?: (event: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => Promise<void> | void
  } | null
}

type EmittablePayload = Record<string, unknown>

const SUBSCRIPTION_EVENT_MAP: Record<string, Parameters<typeof emitPaymentGatewayEvent>[0]> = {
  'customer.subscription.created': 'payment_gateways.subscription.created',
  'customer.subscription.updated': 'payment_gateways.subscription.updated',
  'customer.subscription.deleted': 'payment_gateways.subscription.cancelled',
  'customer.subscription.trial_will_end': 'payment_gateways.subscription.trial_will_end',
  'invoice.paid': 'payment_gateways.invoice.paid',
  'invoice.payment_succeeded': 'payment_gateways.invoice.paid',
  'invoice.payment_failed': 'payment_gateways.invoice.payment_failed',
  'charge.refunded': 'payment_gateways.charge.refunded',
}

export function mapSubscriptionEvent(eventType: string): Parameters<typeof emitPaymentGatewayEvent>[0] | null {
  return SUBSCRIPTION_EVENT_MAP[eventType] ?? null
}

function normalizeWebhookTimestamp(value: unknown): Date {
  if (value instanceof Date) return value

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  return new Date()
}

async function writeLog(
  service: IntegrationLogService | undefined,
  providerKey: string,
  scope: { organizationId: string; tenantId: string },
  subscriptionRef: string | null,
  level: 'info' | 'warn' | 'error',
  message: string,
  payload?: Record<string, unknown>,
) {
  if (!service) return
  await service.write({
    integrationId: `gateway_${providerKey}`,
    scopeEntityType: 'gateway_subscription',
    scopeEntityId: null,
    level,
    message,
    payload: { ...(payload ?? {}), providerSubscriptionId: subscriptionRef },
  }, scope)
}

export async function processSubscriptionWebhookJob(
  deps: Deps,
  payload: PaymentGatewaySubscriptionWebhookJobPayload,
): Promise<void> {
  const { em, integrationLogService } = deps
  const { providerKey, event, scope, ref } = payload
  const trustedScope = { organizationId: scope.organizationId, tenantId: scope.tenantId }

  const claimed = await claimWebhookProcessing(em, event.idempotencyKey, providerKey, trustedScope, event.eventType)
  if (!claimed) {
    await writeLog(integrationLogService, providerKey, trustedScope, ref.providerSubscriptionId ?? null, 'info', 'Duplicate subscription webhook skipped', {
      eventType: event.eventType,
      idempotencyKey: event.idempotencyKey,
    })
    return
  }

  try {
    const mappedEventId = mapSubscriptionEvent(event.eventType)
    if (!mappedEventId) {
      await writeLog(integrationLogService, providerKey, trustedScope, ref.providerSubscriptionId ?? null, 'info', 'Unmapped subscription webhook event', {
        eventType: event.eventType,
      })
      return
    }

    const emitPayload: EmittablePayload = {
      providerKey,
      organizationId: trustedScope.organizationId,
      tenantId: trustedScope.tenantId,
      externalAccountId: scope.externalAccountId ?? null,
      subscriptionId: scope.subscriptionId ?? null,
      subjectEntityType: scope.subjectEntityType ?? null,
      subjectEntityId: scope.subjectEntityId ?? null,
      providerSubscriptionId: ref.providerSubscriptionId ?? null,
      providerCustomerId: ref.providerCustomerId ?? null,
      providerInvoiceId: ref.providerInvoiceId ?? null,
      providerChargeId: ref.providerChargeId ?? null,
      providerEventType: event.eventType,
      providerEventId: event.eventId,
      providerEventCreatedAt: normalizeWebhookTimestamp(event.timestamp).toISOString(),
      data: event.data,
    }

    await emitPaymentGatewayEvent(mappedEventId, emitPayload)

    await writeLog(integrationLogService, providerKey, trustedScope, ref.providerSubscriptionId ?? null, 'info', 'Subscription webhook processed', {
      eventType: event.eventType,
      mappedEventId,
    })
  } catch (error: unknown) {
    await releaseWebhookClaim(em, event.idempotencyKey, providerKey, trustedScope)
    throw error
  }
}
