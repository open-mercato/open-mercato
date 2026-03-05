import Stripe from 'stripe'
import type { VerifyWebhookInput, WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'

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
    data: event.data.object as Record<string, unknown>,
    idempotencyKey: event.id,
    timestamp: new Date(event.created * 1000),
  }
}
