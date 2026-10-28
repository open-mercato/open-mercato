import { REDACTED_PLACEHOLDER } from './redactToolSummary'

const EMAIL_RE = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}/gi
const SECRET_HEADER_RE = /\b(authorization|proxy-authorization|cookie|set-cookie)(\s*[:=]\s*)([^\n;,}]+)/gi
const AUTH_SCHEME_RE = /\b(Bearer|Basic|ApiKey)\s+[A-Za-z0-9._~+/=-]+/gi
const SESSION_AUTHORIZATION_RE = /(Session Authorization\s*:\s*)[A-Za-z0-9._~+/=-]*[A-Za-z0-9_~+/=-]/gi
const SESSION_TOKEN_FIELD_RE = /("?_?sessionToken"?\s*:\s*")[^"]*(")/gi
const SECRET_KEY_RE =
  /(authorization|cookie|password|passwd|\bpwd\b|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|^token$|\bbearer\b|private[-_]?key|credential|^_?session[-_]?token$)/i

export const REDACTED_EMAIL_PLACEHOLDER = '[redacted-email]'
const MAX_DEPTH = 16

export function redactEmails(text: string): string {
  try {
    return text.replace(EMAIL_RE, REDACTED_EMAIL_PLACEHOLDER)
  } catch {
    return REDACTED_PLACEHOLDER
  }
}

export type StringRedactionCounts = Record<string, number>

export type CountedRedaction = { text: string; counts: StringRedactionCounts }

type CountedRule = {
  rule: string
  pattern: RegExp
  replace: (match: string, groups: string[]) => string | null
}

function applyCountedRules(text: string, rules: CountedRule[]): CountedRedaction {
  const counts: StringRedactionCounts = {}
  let current = text
  for (const { rule, pattern, replace } of rules) {
    current = current.replace(pattern, (match: string, ...rest: unknown[]) => {
      const offsetIndex = rest.findIndex((entry) => typeof entry === 'number')
      const captured = offsetIndex < 0 ? [] : rest.slice(0, offsetIndex)
      const groups = captured.map((entry) => (typeof entry === 'string' ? entry : ''))
      const replacement = replace(match, groups)
      if (replacement === null) return match
      counts[rule] = (counts[rule] ?? 0) + 1
      return replacement
    })
  }
  return { text: current, counts }
}

const SECRET_STRING_RULES: CountedRule[] = [
  {
    rule: 'session_authorization',
    pattern: SESSION_AUTHORIZATION_RE,
    replace: (_match, [prefix]) => `${prefix}${REDACTED_PLACEHOLDER}`,
  },
  {
    rule: 'session_token_field',
    pattern: SESSION_TOKEN_FIELD_RE,
    replace: (_match, [prefix, suffix]) => `${prefix}${REDACTED_PLACEHOLDER}${suffix}`,
  },
  {
    rule: 'secret_header',
    pattern: SECRET_HEADER_RE,
    replace: (_match, [name, separator]) => `${name}${separator}${REDACTED_PLACEHOLDER}`,
  },
  {
    rule: 'auth_scheme',
    pattern: AUTH_SCHEME_RE,
    replace: (_match, [scheme]) => `${scheme} ${REDACTED_PLACEHOLDER}`,
  },
]

/** Fails closed: an internal error yields the placeholder, never the unredacted input. */
export function redactSecretStringsCounted(text: string): CountedRedaction {
  try {
    return applyCountedRules(text, SECRET_STRING_RULES)
  } catch {
    return { text: REDACTED_PLACEHOLDER, counts: { redaction_error: 1 } }
  }
}

export function redactSecretStrings(text: string): string {
  return redactSecretStringsCounted(text).text
}

export const REDACTED_PHONE_PLACEHOLDER = '[redacted-phone]'
export const REDACTED_IBAN_PLACEHOLDER = '[redacted-iban]'
export const REDACTED_CARD_PLACEHOLDER = '[redacted-card]'

const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g
const CARD_RE = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g
const PHONE_RE = /(?<![\w+])\+\d{1,3}(?:[ .-]?\(\d{1,4}\))?(?:[ .-]?\d{2,4}){2,5}(?!\d)/g

function digitsOnly(text: string): string {
  return text.replace(/\D/g, '')
}

export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  let sum = 0
  let doubleNext = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48
    if (doubleNext) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleNext = !doubleNext
  }
  return sum % 10 === 0
}

export function passesIbanChecksum(candidate: string): boolean {
  const compact = candidate.replace(/ /g, '')
  if (compact.length < 15 || compact.length > 34) return false
  const rearranged = `${compact.slice(4)}${compact.slice(0, 4)}`
  let remainder = 0
  for (const character of rearranged) {
    const code = character.charCodeAt(0)
    const value = code >= 65 ? String(code - 55) : character
    for (const digit of value) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97
  }
  return remainder === 1
}

const PII_STRING_RULES: CountedRule[] = [
  { rule: 'email', pattern: EMAIL_RE, replace: () => REDACTED_EMAIL_PLACEHOLDER },
  {
    rule: 'iban',
    pattern: IBAN_RE,
    replace: (match) => (passesIbanChecksum(match) ? REDACTED_IBAN_PLACEHOLDER : null),
  },
  {
    rule: 'card',
    pattern: CARD_RE,
    replace: (match) => {
      const digits = digitsOnly(match)
      return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits) ? REDACTED_CARD_PLACEHOLDER : null
    },
  },
  {
    rule: 'phone',
    pattern: PHONE_RE,
    replace: (match) => {
      const length = digitsOnly(match).length
      return length >= 8 && length <= 15 ? REDACTED_PHONE_PLACEHOLDER : null
    },
  },
]

/**
 * Conservative PII pass for free text: emails, IBANs (mod-97 checked), card
 * numbers (Luhn checked) and international `+`-prefixed phone numbers.
 * Fails closed like the secret pass.
 */
export function redactPiiStrings(text: string): CountedRedaction {
  try {
    return applyCountedRules(text, PII_STRING_RULES)
  } catch {
    return { text: REDACTED_PLACEHOLDER, counts: { redaction_error: 1 } }
  }
}

export function redactString(text: string): string {
  return redactEmails(redactSecretStrings(text))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return redactString(value)
  if (depth >= MAX_DEPTH) return isPlainObject(value) || Array.isArray(value) ? REDACTED_PLACEHOLDER : value
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, depth + 1))
  if (isPlainObject(value)) return scrubObject(value, depth + 1)
  return value
}

function scrubObject(source: Record<string, unknown>, depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    result[key] = SECRET_KEY_RE.test(key) ? REDACTED_PLACEHOLDER : scrubValue(value, depth)
  }
  return result
}

/** Fails closed: an internal error yields an empty bag, never the unredacted input. */
export function redactAttributeValues<T extends Record<string, unknown>>(attributes: T): T {
  try {
    return scrubObject(attributes, 0) as T
  } catch {
    return {} as T
  }
}
