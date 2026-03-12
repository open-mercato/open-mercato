import type { CreateSessionInput, CreateSessionResult, UnifiedPaymentStatus } from '@open-mercato/shared/modules/payment_gateways/types'
import type Stripe from 'stripe'
import { resolveStripePaymentLinkConfig, type StripePaymentLinkConfig } from './payment-link-config'
import { buildStripeMetadata, toCents } from './shared'
import { mapStripeStatus } from './status-map'

function readStripeId(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id.trim().length > 0) {
    return value.id.trim()
  }
  return null
}

function resolveHostedCheckoutReturnUrls(input: CreateSessionInput): { successUrl: string; cancelUrl: string } | null {
  const successUrl = typeof input.successUrl === 'string' && input.successUrl.trim().length > 0
    ? input.successUrl.trim()
    : null
  const cancelUrl = typeof input.cancelUrl === 'string' && input.cancelUrl.trim().length > 0
    ? input.cancelUrl.trim()
    : null

  if (successUrl && cancelUrl) {
    return { successUrl, cancelUrl }
  }
  if (successUrl) {
    return { successUrl, cancelUrl: successUrl }
  }
  if (cancelUrl) {
    return { successUrl: cancelUrl, cancelUrl }
  }
  return null
}

function buildHostedCheckoutLineItems(input: CreateSessionInput): Stripe.Checkout.SessionCreateParams.LineItem[] {
  if (Array.isArray(input.lineItems) && input.lineItems.length > 0) {
    return input.lineItems.map((lineItem) => ({
      quantity: lineItem.quantity,
      price_data: {
        currency: lineItem.currencyCode.toLowerCase(),
        unit_amount: toCents(lineItem.unitAmount, lineItem.currencyCode),
        product_data: {
          name: lineItem.name,
        },
      },
    }))
  }

  return [
    {
      quantity: 1,
      price_data: {
        currency: input.currencyCode.toLowerCase(),
        unit_amount: toCents(input.amount, input.currencyCode),
        product_data: {
          name: input.description?.trim() || 'Payment',
        },
      },
    },
  ]
}

function buildPaymentIntentInput(
  input: CreateSessionInput,
  paymentLinkConfig: StripePaymentLinkConfig,
): Stripe.PaymentIntentCreateParams {
  const paymentIntentInput: Stripe.PaymentIntentCreateParams = {
    amount: toCents(input.amount, input.currencyCode),
    currency: input.currencyCode.toLowerCase(),
    capture_method: input.captureMethod ?? 'automatic',
    metadata: buildStripeMetadata({
      paymentId: input.paymentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      orderId: input.orderId,
    }),
    description: input.description,
  }

  if (paymentLinkConfig.paymentMethodMode === 'automatic') {
    paymentIntentInput.automatic_payment_methods = {
      enabled: true,
      allow_redirects: paymentLinkConfig.allowRedirects,
    }
  } else {
    paymentIntentInput.payment_method_types = ['card']
  }

  return paymentIntentInput
}

function mapCheckoutSessionStatus(session: Stripe.Checkout.Session): UnifiedPaymentStatus {
  if (session.payment_status === 'paid') return 'captured'
  return 'pending'
}

export async function createStripePaymentSession(
  stripe: Stripe,
  input: CreateSessionInput,
): Promise<CreateSessionResult> {
  const paymentLinkConfig = resolveStripePaymentLinkConfig(input.providerInput ?? {})
  const publishableKey = typeof input.credentials.publishableKey === 'string'
    ? input.credentials.publishableKey
    : undefined

  if (paymentLinkConfig.profile === 'payment_element_redirect') {
    const returnUrls = resolveHostedCheckoutReturnUrls(input)
    if (returnUrls) {
      const metadata = buildStripeMetadata({
        paymentId: input.paymentId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        orderId: input.orderId,
      })
      const checkoutSession = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: returnUrls.successUrl,
        cancel_url: returnUrls.cancelUrl,
        billing_address_collection: paymentLinkConfig.showBillingAddress ? 'required' : 'auto',
        line_items: buildHostedCheckoutLineItems(input),
        payment_intent_data: {
          capture_method: input.captureMethod ?? 'automatic',
          description: input.description,
          metadata,
        },
        metadata,
        expand: ['payment_intent'],
      })
      const paymentIntentId = readStripeId(checkoutSession.payment_intent)
      if (!paymentIntentId) {
        throw new Error('Stripe Checkout Session did not return a payment intent')
      }

      return {
        sessionId: paymentIntentId,
        redirectUrl: checkoutSession.url ?? undefined,
        status: mapCheckoutSessionStatus(checkoutSession),
        providerData: {
          checkoutSessionId: checkoutSession.id,
          paymentIntentId,
          publishableKey,
          paymentLinkConfig,
        },
      }
    }
  }

  const paymentIntent = await stripe.paymentIntents.create(
    buildPaymentIntentInput(input, paymentLinkConfig),
  )

  return {
    sessionId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret ?? undefined,
    status: mapStripeStatus(paymentIntent.status),
    providerData: {
      paymentIntentId: paymentIntent.id,
      publishableKey,
      paymentLinkConfig,
    },
  }
}

export async function resolveStripePaymentIntentSessionId(
  stripe: Stripe,
  sessionId: string,
): Promise<string> {
  if (!sessionId.startsWith('cs_')) {
    return sessionId
  }

  const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent'],
  })
  const paymentIntentId = readStripeId(checkoutSession.payment_intent)
  if (!paymentIntentId) {
    throw new Error('Stripe Checkout Session is missing a payment intent')
  }
  return paymentIntentId
}
