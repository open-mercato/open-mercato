type CheckoutCustomerFieldLike = {
  key: string
  kind?: string | null
  required?: boolean | null
}

const PHONE_ALLOWED_PATTERN = /^[+()\d\s.-]+$/

export function isValidCheckoutEmail(value: string): boolean {
  const email = value.trim()
  if (!email || email.length > 254) return false

  const atIndex = email.indexOf('@')
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@') || atIndex === email.length - 1) return false

  for (const char of email) {
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') return false
  }

  const localPart = email.slice(0, atIndex)
  const domainPart = email.slice(atIndex + 1)
  if (!localPart || !domainPart || localPart.length > 64) return false
  if (domainPart.length > 253 || !domainPart.includes('.')) return false
  if (domainPart.startsWith('.') || domainPart.endsWith('.') || domainPart.includes('..')) return false

  const domainLabels = domainPart.split('.')
  for (const label of domainLabels) {
    if (!label) return false
    if (label.startsWith('-') || label.endsWith('-')) return false
  }

  return true
}

export function isValidCheckoutPhone(value: string): boolean {
  const phone = value.trim()
  if (!phone) return false
  if (!PHONE_ALLOWED_PATTERN.test(phone)) return false
  return phone.replace(/\D/g, '').length >= 6
}

export function getCheckoutCustomerFieldSemanticType(
  field: Pick<CheckoutCustomerFieldLike, 'key'>,
): 'email' | 'phone' | null {
  const normalizedKey = field.key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (!normalizedKey) return null
  if (normalizedKey === 'email' || normalizedKey.endsWith('email')) return 'email'
  if (
    normalizedKey === 'phone'
    || normalizedKey.endsWith('phone')
    || normalizedKey.endsWith('phonenumber')
    || normalizedKey.endsWith('mobilephone')
  ) {
    return 'phone'
  }
  return null
}

export function validateCheckoutCustomerData(
  fields: CheckoutCustomerFieldLike[],
  customerData: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const nextErrors: Record<string, string> = {}
  const values = customerData && typeof customerData === 'object' ? customerData : {}

  for (const field of fields) {
    const fieldPath = `customerData.${field.key}`
    const value = values[field.key]
    const normalizedValue = typeof value === 'string'
      ? value.trim()
      : value == null
        ? ''
        : String(value).trim()

    if (field.required === true) {
      const isMissing = field.kind === 'boolean'
        ? value !== true
        : normalizedValue.length === 0
      if (isMissing) {
        nextErrors[fieldPath] = 'checkout.payPage.validation.requiredField'
        continue
      }
    }

    if (field.kind === 'boolean' || normalizedValue.length === 0) continue

    const semanticType = getCheckoutCustomerFieldSemanticType(field)
    if (semanticType === 'email' && !isValidCheckoutEmail(normalizedValue)) {
      nextErrors[fieldPath] = 'checkout.payPage.validation.invalidEmail'
      continue
    }
    if (semanticType === 'phone' && !isValidCheckoutPhone(normalizedValue)) {
      nextErrors[fieldPath] = 'checkout.payPage.validation.invalidPhone'
    }
  }

  return nextErrors
}
