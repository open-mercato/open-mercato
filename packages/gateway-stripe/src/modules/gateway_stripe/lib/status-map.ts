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

export function mapRefundReason(reason?: string): 'duplicate' | 'fraudulent' | 'requested_by_customer' | undefined {
  switch (reason) {
    case 'duplicate': return 'duplicate'
    case 'fraud': return 'fraudulent'
    default: return 'requested_by_customer'
  }
}
