import Stripe from 'stripe'
import type { VerifyWebhookInput, WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'

/**
 * Transactions are stored under the PaymentIntent id (`createSession` returns it as the session
 * id). Charge, Refund and Dispute objects carry their own id plus `payment_intent`, so the
 * reference wins over the object id; a PaymentIntent object has no such field and falls back to
 * its own id.
 */
export function readStripeSessionIdHint(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null

  const data = payload.data
  if (data && typeof data === 'object') {
    const nestedObject = (data as Record<string, unknown>).object
    if (nestedObject && typeof nestedObject === 'object') {
      const nestedPaymentIntent = (nestedObject as Record<string, unknown>).payment_intent
      if (typeof nestedPaymentIntent === 'string' && nestedPaymentIntent.trim().length > 0) {
        return nestedPaymentIntent.trim()
      }

      const nestedId = (nestedObject as Record<string, unknown>).id
      if (typeof nestedId === 'string' && nestedId.trim().length > 0) return nestedId.trim()
    }
  }

  const id = payload.id
  if (typeof id === 'string' && id.trim().length > 0) return id.trim()
  return null
}

export async function verifyStripeWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> {
  const stripe = new Stripe(input.credentials.secretKey as string)

  const signature = input.headers['stripe-signature'] as string
  if (!signature) {
    throw new Error('Missing stripe-signature header')
  }

  const event = stripe.webhooks.constructEvent(
    typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf-8'),
    signature,
    input.credentials.webhookSecret as string,
  )

  return {
    eventType: event.type,
    eventId: event.id,
    data: event.data.object as unknown as Record<string, unknown>,
    idempotencyKey: event.id,
    timestamp: new Date(event.created * 1000),
  }
}
