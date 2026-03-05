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
import { resolveStripeClient } from '../client'
import { mapStripeStatus } from '../status-map'
import { toCents, fromCents, buildStripeMetadata } from '../shared'
import { verifyStripeWebhook } from '../webhook-handler'

export const stripeAdapterV20241218: GatewayAdapter = {
  providerKey: 'stripe',

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    const stripe = resolveStripeClient(input.credentials, '2024-12-18')

    const paymentIntent = await stripe.paymentIntents.create({
      amount: toCents(input.amount),
      currency: input.currencyCode.toLowerCase(),
      capture_method: input.captureMethod ?? 'automatic',
      metadata: buildStripeMetadata({
        paymentId: input.paymentId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        orderId: input.orderId,
      }),
      payment_method_types: input.paymentTypes ?? ['card'],
      description: input.description,
    })

    return {
      sessionId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret ?? undefined,
      status: mapStripeStatus(paymentIntent.status),
      providerData: { paymentIntentId: paymentIntent.id },
    }
  },

  async capture(input: CaptureInput): Promise<CaptureResult> {
    const stripe = resolveStripeClient(input.credentials, '2024-12-18')

    const captured = await stripe.paymentIntents.capture(input.sessionId, {
      amount_to_capture: input.amount ? toCents(input.amount) : undefined,
    })

    return {
      status: mapStripeStatus(captured.status),
      capturedAmount: fromCents(captured.amount_received),
      providerData: { chargeId: captured.latest_charge },
    }
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const stripe = resolveStripeClient(input.credentials, '2024-12-18')

    const refund = await stripe.refunds.create({
      payment_intent: input.sessionId,
      amount: input.amount ? toCents(input.amount) : undefined,
      metadata: input.metadata as Record<string, string> | undefined,
    })

    return {
      refundId: refund.id,
      status: refund.status === 'succeeded' ? 'refunded' : 'pending',
      refundedAmount: fromCents(refund.amount),
    }
  },

  async cancel(input: CancelInput): Promise<CancelResult> {
    const stripe = resolveStripeClient(input.credentials, '2024-12-18')

    const cancelled = await stripe.paymentIntents.cancel(input.sessionId, {
      cancellation_reason: 'requested_by_customer',
    })

    return {
      status: mapStripeStatus(cancelled.status),
    }
  },

  async getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus> {
    const stripe = resolveStripeClient(input.credentials, '2024-12-18')

    const pi = await stripe.paymentIntents.retrieve(input.sessionId)
    return {
      status: mapStripeStatus(pi.status),
      amount: fromCents(pi.amount),
      amountReceived: fromCents(pi.amount_received),
      currencyCode: pi.currency.toUpperCase(),
    }
  },

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> {
    return verifyStripeWebhook(input)
  },

  mapStatus(providerStatus: string): UnifiedPaymentStatus {
    return mapStripeStatus(providerStatus)
  },
}
