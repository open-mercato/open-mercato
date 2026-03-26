import type { PaymentGatewayPresentationRequest } from '@open-mercato/shared/modules/payment_gateways/types'

const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
])

function isZeroDecimalCurrency(currencyCode: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currencyCode.toUpperCase())
}

export function toCents(amount: number, currencyCode: string): number {
  return isZeroDecimalCurrency(currencyCode)
    ? Math.round(amount)
    : Math.round(amount * 100)
}

export function fromCents(amount: number, currencyCode: string): number {
  return isZeroDecimalCurrency(currencyCode)
    ? amount
    : amount / 100
}

export function buildStripeMetadata(input: {
  paymentId: string
  tenantId: string
  organizationId: string
  orderId?: string
}): Record<string, string> {
  const meta: Record<string, string> = {
    paymentId: input.paymentId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  }
  if (input.orderId) {
    meta.orderId = input.orderId
  }
  return meta
}

const STRIPE_PAYMENT_METHOD_ORDER = new Set([
  'card',
  'apple_pay',
  'google_pay',
  'link',
])

export type StripePaymentElementSettings = {
  layout?: 'tabs' | 'accordion'
  paymentMethodOrder?: string[]
  billingDetails?: 'auto' | 'never' | 'if_required'
}

export function resolveStripeRendererKey(request?: PaymentGatewayPresentationRequest): string {
  return request?.rendererKey === 'stripe.payment_element'
    ? request.rendererKey
    : 'stripe.payment_element'
}

export function normalizeStripePaymentElementSettings(
  settings: Record<string, unknown> | null | undefined,
): StripePaymentElementSettings | undefined {
  if (!settings) return undefined

  const layout = settings.layout === 'tabs' || settings.layout === 'accordion'
    ? settings.layout
    : undefined
  const billingDetails = settings.billingDetails === 'auto'
    || settings.billingDetails === 'never'
    || settings.billingDetails === 'if_required'
    ? settings.billingDetails
    : undefined
  const paymentMethodOrder = Array.isArray(settings.paymentMethodOrder)
    ? settings.paymentMethodOrder.filter(
        (value): value is string => typeof value === 'string' && STRIPE_PAYMENT_METHOD_ORDER.has(value),
      )
    : []

  if (!layout && !billingDetails && paymentMethodOrder.length === 0) {
    return undefined
  }

  return {
    ...(layout ? { layout } : {}),
    ...(billingDetails ? { billingDetails } : {}),
    ...(paymentMethodOrder.length > 0 ? { paymentMethodOrder } : {}),
  }
}
