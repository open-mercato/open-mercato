import Stripe from 'stripe'
import type {
  SubscriptionWebhookRef,
  VerifyWebhookInput,
  WebhookEvent,
  WebhookEventClassification,
} from '@open-mercato/shared/modules/payment_gateways/types'

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

const SUBSCRIPTION_EVENT_PREFIXES = ['customer.subscription.']
const SUBSCRIPTION_EVENT_NAMES = new Set([
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
])

function readObject(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!payload) return null
  const data = payload.data
  if (!data || typeof data !== 'object') return null
  const obj = (data as Record<string, unknown>).object
  if (!obj || typeof obj !== 'object') return null
  return obj as Record<string, unknown>
}

function readEventType(payload: Record<string, unknown> | null): string {
  if (!payload) return ''
  const type = payload.type
  return typeof type === 'string' ? type : ''
}

function chargeIsSubscriptionLinked(obj: Record<string, unknown>): boolean {
  const invoice = obj.invoice
  if (typeof invoice === 'string' && invoice.length > 0) return true
  if (invoice && typeof invoice === 'object') return true
  return false
}

export function classifyStripeEvent(payload: Record<string, unknown> | null): WebhookEventClassification {
  const eventType = readEventType(payload)
  if (!eventType) return 'unknown'

  if (SUBSCRIPTION_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix))) return 'subscription'
  if (SUBSCRIPTION_EVENT_NAMES.has(eventType)) return 'subscription'

  if (eventType === 'charge.refunded') {
    const obj = readObject(payload)
    if (obj && chargeIsSubscriptionLinked(obj)) return 'subscription'
    return 'transaction'
  }

  if (eventType.startsWith('payment_intent.')) return 'transaction'
  if (eventType.startsWith('charge.')) return 'transaction'
  if (eventType.startsWith('checkout.session.')) return 'transaction'

  return 'unknown'
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readStripeSubscriptionRef(payload: Record<string, unknown> | null): SubscriptionWebhookRef | null {
  const eventType = readEventType(payload)
  const obj = readObject(payload)
  if (!obj || !eventType) return null

  if (eventType.startsWith('customer.subscription.')) {
    return {
      providerSubscriptionId: readString(obj.id),
      providerCustomerId: readString(obj.customer),
    }
  }

  if (eventType === 'invoice.paid' || eventType === 'invoice.payment_succeeded' || eventType === 'invoice.payment_failed') {
    return {
      providerSubscriptionId: readString(obj.subscription),
      providerCustomerId: readString(obj.customer),
      providerInvoiceId: readString(obj.id),
    }
  }

  if (eventType === 'charge.refunded' && chargeIsSubscriptionLinked(obj)) {
    return {
      providerSubscriptionId: null,
      providerCustomerId: readString(obj.customer),
      providerChargeId: readString(obj.id),
    }
  }

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
