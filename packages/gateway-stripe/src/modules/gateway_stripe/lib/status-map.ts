import type { UnifiedPaymentStatus, WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'

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

const STRIPE_BASIL_API_VERSION_DATE = '2025-03-31'

/**
 * Whether the Charge was rendered with an API version older than `2025-03-31.basil`, where a
 * partial capture creates a Refund for the uncaptured remainder and counts it in
 * `amount_refunded`. From Basil on it does not. `null` when the version is absent or unreadable.
 */
function countsUncapturedRemainderAsRefunded(apiVersion: string | null | undefined): boolean | null {
  if (typeof apiVersion !== 'string') return null
  const versionDate = apiVersion.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(versionDate)) return null
  return versionDate < STRIPE_BASIL_API_VERSION_DATE
}

function resolveChargeRefundStatus(
  charge: Record<string, unknown>,
  apiVersion: string | null | undefined,
): UnifiedPaymentStatus {
  if (charge.captured === false) return 'unknown'
  const amountCaptured = readFiniteNumber(charge.amount_captured)
  if (amountCaptured !== null && amountCaptured <= 0) return 'unknown'
  if (charge.refunded === true) return 'refunded'
  const amount = readFiniteNumber(charge.amount)
  const amountRefunded = readFiniteNumber(charge.amount_refunded)
  if (amount === null || amountRefunded === null) return 'unknown'
  const uncaptured = amountCaptured === null ? 0 : Math.max(amount - amountCaptured, 0)
  const captured = amount - uncaptured
  if (captured <= 0) return 'unknown'
  let remainderInRefunded = false
  if (uncaptured > 0) {
    const fitsLegacy = amountRefunded >= uncaptured
    const fitsBasil = amountRefunded <= captured
    if (!fitsLegacy && !fitsBasil) return 'unknown'
    if (fitsLegacy && fitsBasil) {
      const legacySemantics = countsUncapturedRemainderAsRefunded(apiVersion)
      if (legacySemantics === null) return 'unknown'
      remainderInRefunded = legacySemantics
    } else {
      remainderInRefunded = fitsLegacy
    }
  }
  const refundedOfCaptured = amountRefunded - (remainderInRefunded ? uncaptured : 0)
  if (refundedOfCaptured <= 0) return 'unknown'
  return refundedOfCaptured < captured ? 'partially_refunded' : 'refunded'
}

/**
 * Resolves the unified status a verified Stripe webhook event stands for, from the event type,
 * its `data.object` and the API version Stripe rendered it with (the Event's `api_version`).
 * Only `payment_intent.*` events and a `charge.refunded` whose own Charge payload proves a refund
 * of captured funds can move a transaction: `refunded` is terminal, so a partial refund must not
 * be recorded as a full one, and money that was never captured (a released authorization, the
 * uncaptured remainder that pre-Basil versions report as refunded after a partial capture) is not
 * a refund. "Fully refunded" is relative to the captured amount. The amounts decide when only one
 * reading is possible (more refunded than captured means the remainder is counted; less than the
 * remainder means it is not); the version breaks the tie otherwise, and without a version the
 * result is `unknown`. Every other
 * event (refund updates, disputes, other objects that merely reference the PaymentIntent)
 * resolves to `unknown` and causes no status change.
 */
export function resolveStripeWebhookStatus(
  eventType: string,
  data: Record<string, unknown>,
  apiVersion?: string | null,
): UnifiedPaymentStatus {
  if (eventType.startsWith('payment_intent.')) {
    const providerStatus = typeof data.status === 'string' ? data.status : ''
    return mapWebhookEventToStatus(eventType) ?? mapStripeStatus(providerStatus)
  }
  if (eventType === 'charge.refunded') return resolveChargeRefundStatus(data, apiVersion)
  return 'unknown'
}

/**
 * `GatewayAdapter.mapStatus` for every Stripe adapter version. Webhook callers pass the verified
 * event and get the payload-aware resolution; calls without it keep the event-type table.
 */
export function mapStripeAdapterStatus(
  providerStatus: string,
  eventType?: string,
  event?: WebhookEvent,
): UnifiedPaymentStatus {
  if (eventType && event?.data) return resolveStripeWebhookStatus(eventType, event.data, event.apiVersion)
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
