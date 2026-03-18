export type PaymentLinkSessionParams = {
  providerKey: string
  amount: number
  currencyCode: string
  captureMethod?: string
  description?: string
  successUrl?: string
  cancelUrl?: string
  metadata?: Record<string, unknown>
  providerInput?: Record<string, unknown>
}

export type CustomerHandlingMode = 'no_customer' | 'create_new' | 'verify_and_merge'
export type AmountOption = { amount: number; label: string }
export type AmountType = 'fixed' | 'customer_input' | 'predefined'

export type PaymentLinkPageStoredMetadata = {
  amount?: number
  amountType?: AmountType
  amountOptions?: AmountOption[]
  currencyCode?: string
  pageMetadata?: Record<string, unknown>
  customFields?: Record<string, unknown>
  customFieldsetCode?: string | null
  customerFieldsetCode?: string | null
  displayCustomFields?: boolean
  customerFieldValues?: Record<string, unknown>
  sessionParams?: PaymentLinkSessionParams
  customerCapture?: {
    enabled?: boolean
    companyRequired?: boolean
    termsRequired?: boolean
    termsMarkdown?: string | null
    customerHandlingMode?: CustomerHandlingMode
    collectedAt?: string | null
    termsAcceptedAt?: string | null
    companyEntityId?: string | null
    personEntityId?: string | null
    companyName?: string | null
    personName?: string | null
    email?: string | null
    customerCreated?: boolean
    fields?: Record<string, { visible?: boolean; required?: boolean }> | null
  }
}

const RESERVED_KEYS = new Set([
  'amount',
  'amountType',
  'amountOptions',
  'currencyCode',
  'pageMetadata',
  'customFields',
  'customFieldsetCode',
  'customerFieldsetCode',
  'displayCustomFields',
  'customerFieldValues',
  'customerCapture',
  'sessionParams',
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

const VALID_CUSTOMER_HANDLING_MODES = new Set<CustomerHandlingMode>(['no_customer', 'create_new', 'verify_and_merge'])

function toCustomerHandlingMode(input: unknown): CustomerHandlingMode {
  if (typeof input === 'string' && VALID_CUSTOMER_HANDLING_MODES.has(input as CustomerHandlingMode)) {
    return input as CustomerHandlingMode
  }
  return 'no_customer'
}

function toCustomerCapture(input: unknown): PaymentLinkPageStoredMetadata['customerCapture'] | undefined {
  const source = toPlainObject(input)
  if (!Object.keys(source).length) return undefined
  const rawFields = toPlainObject(source.fields)
  const fields = Object.keys(rawFields).length > 0
    ? rawFields as Record<string, { visible?: boolean; required?: boolean }>
    : null

  return {
    enabled: source.enabled === true,
    companyRequired: source.companyRequired === true,
    termsRequired: source.termsRequired === true,
    termsMarkdown: toStringOrNull(source.termsMarkdown),
    customerHandlingMode: toCustomerHandlingMode(source.customerHandlingMode),
    collectedAt: toStringOrNull(source.collectedAt),
    termsAcceptedAt: toStringOrNull(source.termsAcceptedAt),
    companyEntityId: toStringOrNull(source.companyEntityId),
    personEntityId: toStringOrNull(source.personEntityId),
    companyName: toStringOrNull(source.companyName),
    personName: toStringOrNull(source.personName),
    email: toStringOrNull(source.email),
    customerCreated: source.customerCreated === true,
    fields,
  }
}

export function buildPaymentLinkStoredMetadata(input: PaymentLinkPageStoredMetadata): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (typeof input.amount === 'number' && Number.isFinite(input.amount)) payload.amount = input.amount
  if (input.amountType && input.amountType !== 'fixed') payload.amountType = input.amountType
  if (Array.isArray(input.amountOptions) && input.amountOptions.length > 0) payload.amountOptions = input.amountOptions
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
  if (typeof input.customerFieldsetCode === 'string' && input.customerFieldsetCode.trim().length > 0) {
    payload.customerFieldsetCode = input.customerFieldsetCode.trim()
  }
  if (input.displayCustomFields === true) {
    payload.displayCustomFields = true
  }
  if (input.customerFieldValues && Object.keys(input.customerFieldValues).length > 0) {
    payload.customerFieldValues = input.customerFieldValues
  }
  if (input.customerCapture && Object.keys(input.customerCapture).length > 0) {
    payload.customerCapture = input.customerCapture
  }
  if (input.sessionParams && typeof input.sessionParams.providerKey === 'string') {
    payload.sessionParams = input.sessionParams
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

  const rawSessionParams = toPlainObject(source.sessionParams)
  const sessionParams: PaymentLinkSessionParams | undefined =
    typeof rawSessionParams.providerKey === 'string' && rawSessionParams.providerKey.length > 0
      ? {
          providerKey: rawSessionParams.providerKey as string,
          amount: toNumber(rawSessionParams.amount) ?? 0,
          currencyCode: (toStringOrNull(rawSessionParams.currencyCode) ?? '') as string,
          captureMethod: toStringOrNull(rawSessionParams.captureMethod) ?? undefined,
          description: toStringOrNull(rawSessionParams.description) ?? undefined,
          successUrl: toStringOrNull(rawSessionParams.successUrl) ?? undefined,
          cancelUrl: toStringOrNull(rawSessionParams.cancelUrl) ?? undefined,
          metadata: Object.keys(toPlainObject(rawSessionParams.metadata)).length > 0
            ? toPlainObject(rawSessionParams.metadata)
            : undefined,
          providerInput: Object.keys(toPlainObject(rawSessionParams.providerInput)).length > 0
            ? toPlainObject(rawSessionParams.providerInput)
            : undefined,
        }
      : undefined

  const rawAmountType = toStringOrNull(source.amountType)
  const amountType: AmountType | undefined =
    rawAmountType === 'customer_input' || rawAmountType === 'predefined' ? rawAmountType : undefined
  const rawAmountOptions = Array.isArray(source.amountOptions) ? source.amountOptions : undefined
  const amountOptions: AmountOption[] | undefined = rawAmountOptions
    ?.filter((opt): opt is Record<string, unknown> => opt != null && typeof opt === 'object')
    .map(opt => ({ amount: toNumber(opt.amount) ?? 0, label: toStringOrNull(opt.label) ?? '' }))
    .filter(opt => opt.amount > 0 && opt.label.length > 0)

  return {
    amount: toNumber(source.amount),
    amountType: amountType ?? 'fixed',
    amountOptions: amountOptions && amountOptions.length > 0 ? amountOptions : undefined,
    currencyCode: toStringOrNull(source.currencyCode) ?? undefined,
    pageMetadata: Object.keys(pageMetadata).length > 0 ? pageMetadata : undefined,
    customFields: Object.keys(toPlainObject(source.customFields)).length > 0
      ? toPlainObject(source.customFields)
      : undefined,
    customFieldsetCode: toStringOrNull(source.customFieldsetCode),
    customerFieldsetCode: toStringOrNull(source.customerFieldsetCode),
    displayCustomFields: source.displayCustomFields === true,
    customerFieldValues: Object.keys(toPlainObject(source.customerFieldValues)).length > 0
      ? toPlainObject(source.customerFieldValues)
      : undefined,
    sessionParams,
    customerCapture: toCustomerCapture(source.customerCapture),
  }
}
