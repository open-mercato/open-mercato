import type { UnifiedPaymentStatus } from '@open-mercato/shared/modules/payment_gateways/types'

const STRIPE_STATUS_MAP: Record<string, UnifiedPaymentStatus> = {
  requires_payment_method: 'pending',
  requires_confirmation: 'pending',
  requires_action: 'pending',
  processing: 'pending',
  requires_capture: 'authorized',
  succeeded: 'captured',
  canceled: 'cancelled',
}

export function mapStripeStatus(stripeStatus: string): UnifiedPaymentStatus {
  return STRIPE_STATUS_MAP[stripeStatus] ?? 'unknown'
}

const WEBHOOK_EVENT_MAP: Record<string, UnifiedPaymentStatus> = {
  'payment_intent.succeeded': 'captured',
  'payment_intent.payment_failed': 'failed',
  'payment_intent.canceled': 'cancelled',
  'payment_intent.requires_action': 'pending',
  'charge.refunded': 'refunded',
  'charge.refund.updated': 'refunded',
  'charge.dispute.created': 'failed',
  'charge.dispute.closed': 'captured',
}

export function mapWebhookEventToStatus(eventType: string): UnifiedPaymentStatus | undefined {
  return WEBHOOK_EVENT_MAP[eventType]
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function resolveChargeRefundStatus(charge: Record<string, unknown>): UnifiedPaymentStatus {
  if (charge.captured === false) return 'unknown'
  const amountCaptured = readFiniteNumber(charge.amount_captured)
  if (amountCaptured !== null && amountCaptured <= 0) return 'unknown'
  if (charge.refunded === true) return 'refunded'
  const amount = readFiniteNumber(charge.amount)
  const amountRefunded = readFiniteNumber(charge.amount_refunded)
  if (amount === null || amountRefunded === null) return 'unknown'
  const uncaptured = amountCaptured === null ? 0 : Math.max(amount - amountCaptured, 0)
  const captured = amount - uncaptured
  const refundedOfCaptured = amountRefunded - uncaptured
  if (captured <= 0 || refundedOfCaptured <= 0) return 'unknown'
  return refundedOfCaptured < captured ? 'partially_refunded' : 'refunded'
}

/**
 * Resolves the unified status a verified Stripe webhook event stands for, from the event type
 * and its `data.object`. Only `payment_intent.*` events and a `charge.refunded` whose own Charge
 * payload proves a refund can move a transaction: `refunded` is terminal, so a partial refund
 * must not be recorded as a full one, and money that was never captured (a released
 * authorization, the uncaptured remainder of a partial capture) is not a refund. Every other
 * event (refund updates, disputes, other objects that merely reference the PaymentIntent)
 * resolves to `unknown` and causes no status change.
 */
export function resolveStripeWebhookStatus(
  eventType: string,
  data: Record<string, unknown>,
): UnifiedPaymentStatus {
  if (eventType.startsWith('payment_intent.')) {
    const providerStatus = typeof data.status === 'string' ? data.status : ''
    return mapWebhookEventToStatus(eventType) ?? mapStripeStatus(providerStatus)
  }
  if (eventType === 'charge.refunded') return resolveChargeRefundStatus(data)
  return 'unknown'
}

/**
 * `GatewayAdapter.mapStatus` for every Stripe adapter version. Webhook callers pass the event
 * payload and get the payload-aware resolution; calls without it keep the event-type table.
 */
export function mapStripeAdapterStatus(
  providerStatus: string,
  eventType?: string,
  eventData?: Record<string, unknown>,
): UnifiedPaymentStatus {
  if (eventType && eventData) return resolveStripeWebhookStatus(eventType, eventData)
  if (eventType) {
    const mappedEvent = mapWebhookEventToStatus(eventType)
    if (mappedEvent) return mappedEvent
  }
  return mapStripeStatus(providerStatus)
}

export function mapRefundReason(reason?: string): 'duplicate' | 'fraudulent' | 'requested_by_customer' | undefined {
  switch (reason) {
    case 'duplicate': return 'duplicate'
    case 'fraud': return 'fraudulent'
    default: return 'requested_by_customer'
  }
}
