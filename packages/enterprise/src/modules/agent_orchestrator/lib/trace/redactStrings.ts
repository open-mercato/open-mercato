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
    return text
  }
}

export function redactSecretStrings(text: string): string {
  try {
    return text
      .replace(SESSION_AUTHORIZATION_RE, (_match, prefix: string) => `${prefix}${REDACTED_PLACEHOLDER}`)
      .replace(SESSION_TOKEN_FIELD_RE, (_match, prefix: string, suffix: string) => `${prefix}${REDACTED_PLACEHOLDER}${suffix}`)
      .replace(SECRET_HEADER_RE, (_match, name: string, separator: string) => `${name}${separator}${REDACTED_PLACEHOLDER}`)
      .replace(AUTH_SCHEME_RE, (_match, scheme: string) => `${scheme} ${REDACTED_PLACEHOLDER}`)
  } catch {
    return text
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return redactEmails(redactSecretStrings(value))
  if (depth >= MAX_DEPTH) return value
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

export function redactAttributeValues<T extends Record<string, unknown>>(attributes: T): T {
  try {
    return scrubObject(attributes, 0) as T
  } catch {
    return { ...attributes }
  }
}
