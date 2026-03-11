import Stripe from 'stripe'
import type { VerifyWebhookInput, WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'

export function readStripeSessionIdHint(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null

  const data = payload.data
  if (data && typeof data === 'object') {
    const nestedObject = (data as Record<string, unknown>).object
    if (nestedObject && typeof nestedObject === 'object') {
      const nestedId = (nestedObject as Record<string, unknown>).id
      if (typeof nestedId === 'string' && nestedId.trim().length > 0) return nestedId.trim()

      const nestedPaymentIntent = (nestedObject as Record<string, unknown>).payment_intent
      if (typeof nestedPaymentIntent === 'string' && nestedPaymentIntent.trim().length > 0) {
        return nestedPaymentIntent.trim()
      }
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
