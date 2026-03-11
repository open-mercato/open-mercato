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
