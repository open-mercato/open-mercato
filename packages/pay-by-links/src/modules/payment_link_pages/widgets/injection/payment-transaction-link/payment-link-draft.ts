import { isValidCustomPaymentLinkToken } from '../../../lib/payment-links'

export type PaymentLinkDraft = {
  enabled?: boolean
  title?: string
  description?: string
  password?: string
  token?: string
  metadata?: Record<string, unknown>
  customFields?: Record<string, unknown>
  customFieldsetCode?: string
  customerCapture?: {
    enabled?: boolean
    companyRequired?: boolean
    termsRequired?: boolean
    termsMarkdown?: string
  }
}

export function readPaymentLinkDraft(input: unknown): PaymentLinkDraft | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  return input as PaymentLinkDraft
}

export function normalizePaymentLinkDraft(input: unknown): PaymentLinkDraft | null {
  const draft = readPaymentLinkDraft(input)
  if (!draft?.enabled) return null

  const title = typeof draft.title === 'string' ? draft.title.trim() : ''
  const description = typeof draft.description === 'string' ? draft.description.trim() : ''
  const password = typeof draft.password === 'string' ? draft.password.trim() : ''
  const token = typeof draft.token === 'string' ? draft.token.trim().toLowerCase() : ''
  const customFieldsetCode = typeof draft.customFieldsetCode === 'string' ? draft.customFieldsetCode.trim() : ''
  const metadata =
    draft.metadata && typeof draft.metadata === 'object' && !Array.isArray(draft.metadata)
      ? draft.metadata
      : undefined
  const customFields =
    draft.customFields && typeof draft.customFields === 'object' && !Array.isArray(draft.customFields)
      ? draft.customFields
      : undefined

  const customerCapture = draft.customerCapture?.enabled
    ? {
        enabled: true,
        companyRequired: draft.customerCapture.companyRequired === true,
        termsRequired: draft.customerCapture.termsRequired === true,
        termsMarkdown:
          draft.customerCapture.termsRequired && typeof draft.customerCapture.termsMarkdown === 'string'
            ? draft.customerCapture.termsMarkdown.trim()
            : undefined,
      }
    : undefined

  return {
    enabled: true,
    title: title || undefined,
    description: description || undefined,
    password: password || undefined,
    token: token || undefined,
    metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
    customFields: customFields && Object.keys(customFields).length > 0 ? customFields : undefined,
    customFieldsetCode: customFieldsetCode || undefined,
    customerCapture,
  }
}

export function validatePaymentLinkDraft(input: unknown): string[] {
  const draft = normalizePaymentLinkDraft(input)
  if (!draft) return []

  const errors: string[] = []

  if (!draft.title) {
    errors.push('Enter a title for the payment link.')
  }
  if (draft.description && draft.description.length > 500) {
    errors.push('Link description must be 500 characters or fewer.')
  }
  if (draft.password && draft.password.length < 4) {
    errors.push('Password must be at least 4 characters.')
  }
  if (draft.token && !isValidCustomPaymentLinkToken(draft.token)) {
    errors.push('Custom link path must use only letters, numbers, and dashes, and be 3 to 80 characters long.')
  }
  if (
    draft.customerCapture?.enabled &&
    draft.customerCapture.termsRequired &&
    (!draft.customerCapture.termsMarkdown || draft.customerCapture.termsMarkdown.length === 0)
  ) {
    errors.push('Enter the markdown content that the customer must accept.')
  }

  return errors
}
