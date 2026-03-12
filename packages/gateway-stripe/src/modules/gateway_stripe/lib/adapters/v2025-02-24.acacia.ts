import type {
  GatewayAdapter,
  CreateSessionInput,
  CreateSessionResult,
  CaptureInput,
  CaptureResult,
  RefundInput,
  RefundResult,
  CancelInput,
  CancelResult,
  GetStatusInput,
  GatewayPaymentStatus,
  VerifyWebhookInput,
  WebhookEvent,
  UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'
import type Stripe from 'stripe'
import { resolveStripeClient } from '../client'
import { mapRefundReason, mapStripeStatus, mapWebhookEventToStatus } from '../status-map'
import { toCents, fromCents } from '../shared'
import { verifyStripeWebhook } from '../webhook-handler'
import { createStripePaymentSession, resolveStripePaymentIntentSessionId } from '../session'

const STRIPE_API_VERSION = '2025-02-24.acacia'

export const stripeAdapterV20250224Acacia: GatewayAdapter = {
  providerKey: 'stripe',

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    const stripe = resolveStripeClient(input.credentials, STRIPE_API_VERSION)
    return createStripePaymentSession(stripe, input)
  },

  async capture(input: CaptureInput): Promise<CaptureResult> {
    const stripe = resolveStripeClient(input.credentials, STRIPE_API_VERSION)
    const paymentIntentSessionId = await resolveStripePaymentIntentSessionId(stripe, input.sessionId)
    const paymentIntent = input.amount
      ? await stripe.paymentIntents.retrieve(paymentIntentSessionId)
      : null

    const captured = await stripe.paymentIntents.capture(paymentIntentSessionId, {
      amount_to_capture: input.amount && paymentIntent
        ? toCents(input.amount, paymentIntent.currency)
        : undefined,
    })

    return {
      status: mapStripeStatus(captured.status),
      capturedAmount: fromCents(captured.amount_received, captured.currency),
      providerData: { chargeId: captured.latest_charge },
    }
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const stripe = resolveStripeClient(input.credentials, STRIPE_API_VERSION)
    const paymentIntentSessionId = await resolveStripePaymentIntentSessionId(stripe, input.sessionId)
    const paymentIntent = input.amount
      ? await stripe.paymentIntents.retrieve(paymentIntentSessionId)
      : null

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentSessionId,
      amount: input.amount && paymentIntent
        ? toCents(input.amount, paymentIntent.currency)
        : undefined,
      reason: mapRefundReason(input.reason),
      metadata: input.metadata as Record<string, string> | undefined,
    })

    return {
      refundId: refund.id,
      status: refund.status === 'succeeded' ? 'refunded' : 'pending',
      refundedAmount: fromCents(refund.amount, refund.currency),
    }
  },

  async cancel(input: CancelInput): Promise<CancelResult> {
    const stripe = resolveStripeClient(input.credentials, STRIPE_API_VERSION)
    const paymentIntentSessionId = await resolveStripePaymentIntentSessionId(stripe, input.sessionId)

    const cancelled = await stripe.paymentIntents.cancel(paymentIntentSessionId, {
      cancellation_reason: 'requested_by_customer',
    })

    return {
      status: mapStripeStatus(cancelled.status),
    }
  },

  async getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus> {
    const stripe = resolveStripeClient(input.credentials, STRIPE_API_VERSION)
    const paymentIntentSessionId = await resolveStripePaymentIntentSessionId(stripe, input.sessionId)

    const pi = await stripe.paymentIntents.retrieve(paymentIntentSessionId)
    return {
      status: mapStripeStatus(pi.status),
      amount: fromCents(pi.amount, pi.currency),
      amountReceived: fromCents(pi.amount_received, pi.currency),
      currencyCode: pi.currency.toUpperCase(),
    }
  },

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> {
    return verifyStripeWebhook(input)
  },

  mapStatus(providerStatus: string, eventType?: string): UnifiedPaymentStatus {
    if (eventType) {
      const mappedEvent = mapWebhookEventToStatus(eventType)
      if (mappedEvent) return mappedEvent
    }
    return mapStripeStatus(providerStatus)
  },
}
