import Stripe from 'stripe'
import type {
  CancelInput,
  CancelResult,
  CaptureInput,
  CaptureResult,
  CreateSessionInput,
  CreateSessionResult,
  GatewayAdapter,
  GatewayPaymentStatus,
  GatewayWebhookEvent,
  GetStatusInput,
  RefundInput,
  RefundResult,
  VerifyWebhookInput,
} from '@open-mercato/core/modules/payment_gateways/lib/adapter'
import { stripeGatewaySettingsSchema } from '../data/validators'
import { resolveStripeCredentials } from './credentials'
import { mapStripeStatus } from './status-map'

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2024-12-18.acacia'

function toAmountMinor(value: number): number {
  return Math.round(Math.max(0, value) * 100)
}

function getStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 10_000,
  })
}

function normalizeSettings(settings: Record<string, unknown>) {
  return stripeGatewaySettingsSchema.parse(settings ?? {})
}

function resolveMethodTypes(input: CreateSessionInput, settings: ReturnType<typeof normalizeSettings>): string[] {
  const preferred = input.paymentMethodTypes?.filter((value) => value.trim().length > 0)
  if (preferred && preferred.length > 0) return preferred
  return settings.paymentMethodTypes
}

function resolveLineItems(input: CreateSessionInput): Stripe.Checkout.SessionCreateParams.LineItem[] {
  if (Array.isArray(input.lineItems) && input.lineItems.length > 0) {
    return input.lineItems.map((line) => ({
      quantity: Math.max(1, line.quantity),
      price_data: {
        currency: input.currencyCode.toLowerCase(),
        unit_amount: toAmountMinor(line.amount),
        product_data: { name: line.name || 'Item' },
      },
    }))
  }

  return [
    {
      quantity: 1,
      price_data: {
        currency: input.currencyCode.toLowerCase(),
        unit_amount: toAmountMinor(input.amount),
        product_data: { name: input.orderNumber ? `Order ${input.orderNumber}` : 'Payment' },
      },
    },
  ]
}

export const stripeAdapterV20241218: GatewayAdapter = {
  providerKey: 'stripe',

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    const settings = normalizeSettings(input.settings)
    const credentials = await resolveStripeCredentials(settings, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    })

    const stripe = getStripeClient(credentials.secretKey)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail,
      payment_method_types: resolveMethodTypes(input, settings),
      allow_promotion_codes: settings.allowPromotionCodes,
      line_items: resolveLineItems(input),
      locale: input.locale as Stripe.Checkout.SessionCreateParams.Locale | undefined,
      payment_intent_data: {
        capture_method: settings.captureMethod,
        description: input.orderNumber ? `Order ${input.orderNumber}` : undefined,
        statement_descriptor: settings.statementDescriptor,
        metadata: {
          ...(input.metadata ?? {}),
          orderId: input.orderId ?? '',
          orderNumber: input.orderNumber ?? '',
          organizationId: input.organizationId,
          tenantId: input.tenantId,
        },
      },
      metadata: {
        ...(input.metadata ?? {}),
        orderId: input.orderId ?? '',
        orderNumber: input.orderNumber ?? '',
      },
    })

    return {
      sessionId: session.id,
      redirectUrl: session.url ?? undefined,
      gatewayStatus: session.payment_status ?? 'unpaid',
      unifiedStatus: mapStripeStatus(session.payment_status ?? 'unpaid'),
      providerData: {
        checkoutSessionId: session.id,
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
      },
    }
  },

  async capture(input: CaptureInput): Promise<CaptureResult> {
    const settings = normalizeSettings(input.settings)
    const credentials = await resolveStripeCredentials(settings, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    })

    const stripe = getStripeClient(credentials.secretKey)
    const captured = await stripe.paymentIntents.capture(input.sessionId, {
      amount_to_capture: input.amount ? toAmountMinor(input.amount) : undefined,
    })

    return {
      gatewayStatus: captured.status,
      unifiedStatus: mapStripeStatus(captured.status),
      capturedAmount: captured.amount_received / 100,
      providerData: {
        paymentIntentId: captured.id,
        latestCharge: captured.latest_charge,
      },
    }
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const settings = normalizeSettings(input.settings)
    const credentials = await resolveStripeCredentials(settings, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    })

    const stripe = getStripeClient(credentials.secretKey)
    const refund = await stripe.refunds.create({
      payment_intent: input.sessionId,
      amount: input.amount ? toAmountMinor(input.amount) : undefined,
      reason: input.reason === 'duplicate' ? 'duplicate' : 'requested_by_customer',
      metadata: input.metadata,
    })

    const status = refund.status || 'pending'
    return {
      refundId: refund.id,
      gatewayStatus: status,
      unifiedStatus: status === 'succeeded' ? 'refunded' : 'processing',
      refundedAmount: (refund.amount ?? 0) / 100,
      providerData: {
        paymentIntentId: refund.payment_intent,
      },
    }
  },

  async cancel(input: CancelInput): Promise<CancelResult> {
    const settings = normalizeSettings(input.settings)
    const credentials = await resolveStripeCredentials(settings, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    })

    const stripe = getStripeClient(credentials.secretKey)
    const canceled = await stripe.paymentIntents.cancel(input.sessionId, {
      cancellation_reason: 'requested_by_customer',
    })

    return {
      gatewayStatus: canceled.status,
      unifiedStatus: mapStripeStatus(canceled.status),
      providerData: {
        paymentIntentId: canceled.id,
      },
    }
  },

  async getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus> {
    const settings = normalizeSettings(input.settings)
    const credentials = await resolveStripeCredentials(settings, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    })

    const stripe = getStripeClient(credentials.secretKey)
    const paymentIntent = await stripe.paymentIntents.retrieve(input.sessionId)

    return {
      gatewayStatus: paymentIntent.status,
      unifiedStatus: mapStripeStatus(paymentIntent.status),
      amount: paymentIntent.amount / 100,
      capturedAmount: paymentIntent.amount_received / 100,
      currencyCode: paymentIntent.currency.toUpperCase(),
      providerData: {
        paymentIntentId: paymentIntent.id,
      },
    }
  },

  async verifyWebhook(input: VerifyWebhookInput): Promise<GatewayWebhookEvent> {
    const settings = normalizeSettings(input.settings)
    const credentials = await resolveStripeCredentials(settings, {
      organizationId: '',
      tenantId: '',
    })

    if (!credentials.webhookSecret) {
      throw new Error('Stripe webhook secret is missing')
    }

    const stripe = getStripeClient(credentials.secretKey)
    const signature = input.headers['stripe-signature']
    if (typeof signature !== 'string') {
      throw new Error('Missing stripe-signature header')
    }

    const payload = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8')
    const event = stripe.webhooks.constructEvent(payload, signature, credentials.webhookSecret)
    const object = (event.data.object ?? {}) as Record<string, unknown>

    const sessionId =
      typeof object.id === 'string'
        ? object.id
        : (typeof object.payment_intent === 'string' ? object.payment_intent : undefined)

    return {
      eventType: event.type,
      eventId: event.id,
      sessionId,
      gatewayStatus: typeof object.status === 'string' ? object.status : event.type,
      unifiedStatus: mapStripeStatus(typeof object.status === 'string' ? object.status : event.type, event.type),
      occurredAt: new Date(event.created * 1000),
      payload: object,
      idempotencyKey: event.id,
    }
  },

  mapStatus: mapStripeStatus,
}
