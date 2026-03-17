export type PaymentLinkPageStoredMetadata = {
  amount?: number
  currencyCode?: string
  pageMetadata?: Record<string, unknown>
  customFields?: Record<string, unknown>
  customFieldsetCode?: string | null
  customerCapture?: {
    enabled?: boolean
    companyRequired?: boolean
    termsRequired?: boolean
    termsMarkdown?: string | null
    collectedAt?: string | null
    termsAcceptedAt?: string | null
    companyEntityId?: string | null
    personEntityId?: string | null
    companyName?: string | null
    personName?: string | null
    email?: string | null
  }
}

const RESERVED_KEYS = new Set([
  'amount',
  'currencyCode',
  'pageMetadata',
  'customFields',
  'customFieldsetCode',
  'customerCapture',
])

function toPlainObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

function toNumber(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) return input
  return undefined
}

function toStringOrNull(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  return trimmed.length ? trimmed : null
}

function toCustomerCapture(input: unknown): PaymentLinkPageStoredMetadata['customerCapture'] | undefined {
  const source = toPlainObject(input)
  if (!Object.keys(source).length) return undefined
  return {
    enabled: source.enabled === true,
    companyRequired: source.companyRequired !== false,
    termsRequired: source.termsRequired === true,
    termsMarkdown: toStringOrNull(source.termsMarkdown),
    collectedAt: toStringOrNull(source.collectedAt),
    termsAcceptedAt: toStringOrNull(source.termsAcceptedAt),
    companyEntityId: toStringOrNull(source.companyEntityId),
    personEntityId: toStringOrNull(source.personEntityId),
    companyName: toStringOrNull(source.companyName),
    personName: toStringOrNull(source.personName),
    email: toStringOrNull(source.email),
  }
}

export function buildPaymentLinkStoredMetadata(input: PaymentLinkPageStoredMetadata): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (typeof input.amount === 'number' && Number.isFinite(input.amount)) payload.amount = input.amount
  if (typeof input.currencyCode === 'string' && input.currencyCode.trim().length > 0) {
    payload.currencyCode = input.currencyCode.trim().toUpperCase()
  }
  if (input.pageMetadata && Object.keys(input.pageMetadata).length > 0) {
    payload.pageMetadata = input.pageMetadata
  }
  if (input.customFields && Object.keys(input.customFields).length > 0) {
    payload.customFields = input.customFields
  }
  if (typeof input.customFieldsetCode === 'string' && input.customFieldsetCode.trim().length > 0) {
    payload.customFieldsetCode = input.customFieldsetCode.trim()
  }
  if (input.customerCapture && Object.keys(input.customerCapture).length > 0) {
    payload.customerCapture = input.customerCapture
  }
  return payload
}

export function readPaymentLinkStoredMetadata(input: unknown): PaymentLinkPageStoredMetadata {
  const source = toPlainObject(input)
  const explicitPageMetadata = toPlainObject(source.pageMetadata)
  const fallbackPageMetadata = Object.entries(source).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (RESERVED_KEYS.has(key)) return acc
    acc[key] = value
    return acc
  }, {})
  const pageMetadata = Object.keys(explicitPageMetadata).length > 0
    ? explicitPageMetadata
    : fallbackPageMetadata

  return {
    amount: toNumber(source.amount),
    currencyCode: toStringOrNull(source.currencyCode) ?? undefined,
    pageMetadata: Object.keys(pageMetadata).length > 0 ? pageMetadata : undefined,
    customFields: Object.keys(toPlainObject(source.customFields)).length > 0
      ? toPlainObject(source.customFields)
      : undefined,
    customFieldsetCode: toStringOrNull(source.customFieldsetCode),
    customerCapture: toCustomerCapture(source.customerCapture),
  }
}
