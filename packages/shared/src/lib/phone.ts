export const PHONE_MIN_DIGITS = 7
export const PHONE_MAX_DIGITS = 15

const DIGIT_PATTERN = /\d+/g
const PHONE_ALLOWED_CHARACTERS = /^[+\d\s\-().]+$/

export type PhoneValidationReason =
  | 'missing_country_code'
  | 'invalid_characters'
  | 'invalid_plus_sign'
  | 'too_short'
  | 'too_long'

export type PhoneValidationResult = {
  valid: boolean
  normalized: string | null
  digits: string
  reason: PhoneValidationReason | null
}

export function extractPhoneDigits(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  const matches = value.match(DIGIT_PATTERN)
  return matches ? matches.join('') : ''
}

export function validatePhoneNumber(value: string | null | undefined): PhoneValidationResult {
  if (typeof value !== 'string') {
    return { valid: true, normalized: null, digits: '', reason: null }
  }

  const normalized = value.trim()
  if (!normalized) {
    return { valid: true, normalized: null, digits: '', reason: null }
  }

  const digits = extractPhoneDigits(normalized)

  if (!normalized.startsWith('+')) {
    return { valid: false, normalized, digits, reason: 'missing_country_code' }
  }

  if (!PHONE_ALLOWED_CHARACTERS.test(normalized)) {
    return { valid: false, normalized, digits, reason: 'invalid_characters' }
  }

  const plusCount = (normalized.match(/\+/g) ?? []).length
  if (plusCount !== 1) {
    return { valid: false, normalized, digits, reason: 'invalid_plus_sign' }
  }

  if (digits.length < PHONE_MIN_DIGITS) {
    return { valid: false, normalized, digits, reason: 'too_short' }
  }

  if (digits.length > PHONE_MAX_DIGITS) {
    return { valid: false, normalized, digits, reason: 'too_long' }
  }

  return { valid: true, normalized, digits, reason: null }
}

export function isValidPhoneNumber(value: string | null | undefined): boolean {
  return validatePhoneNumber(value).valid
}
