import type { UnifiedPaymentStatus } from '@open-mercato/core/modules/payment_gateways/lib/adapter'

const STRIPE_STATUS_MAP: Record<string, UnifiedPaymentStatus> = {
  requires_payment_method: 'pending',
  requires_confirmation: 'pending',
  requires_action: 'pending',
  processing: 'processing',
  requires_capture: 'authorized',
  succeeded: 'captured',
  canceled: 'cancelled',
}

const STRIPE_EVENT_MAP: Record<string, UnifiedPaymentStatus> = {
  'payment_intent.succeeded': 'captured',
  'payment_intent.payment_failed': 'failed',
  'payment_intent.canceled': 'cancelled',
  'payment_intent.requires_action': 'pending',
  'charge.refunded': 'refunded',
  'charge.dispute.created': 'disputed',
}

export function mapStripeStatus(status: string, eventType?: string): UnifiedPaymentStatus {
  if (eventType && STRIPE_EVENT_MAP[eventType]) {
    return STRIPE_EVENT_MAP[eventType]
  }
  return STRIPE_STATUS_MAP[status] ?? 'unknown'
}
