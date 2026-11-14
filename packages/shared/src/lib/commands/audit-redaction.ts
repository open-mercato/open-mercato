export const AUDIT_REDACTED_VALUE = '[REDACTED]'
export const AUDIT_REDO_UNAVAILABLE_KEY = '__redoUnavailable'
export const AUDIT_REDO_UNAVAILABLE_REASON = 'sensitive-data-redacted'

// Matched against the key split into words (camelCase, snake_case, kebab-case, digit
// boundaries), so `secretKey`, `privateKeyPem` and `tokenValue` are caught while
// `footprint`, `secretary` and `tokenizer` are not.
const SENSITIVE_KEY_TERMS = [
  'password',
  'passwords',
  'passphrase',
  'passphrases',
  'secret',
  'secrets',
  'token',
  'tokens',
  'api_key',
  'api_keys',
  'private_key',
  'private_keys',
  'recovery_code',
  'recovery_codes',
  'credential',
  'credentials',
  'authorization',
  'auth_header',
  'cookie',
  'cookies',
  'otp',
  'otps',
] as const

// A key whose last word names a derived attribute (`passwordHash`, `tokenId`,
// `accessTokenExpiresAt`, `tokenCount`) carries no secret material.
const DERIVED_ATTRIBUTE_SUFFIXES = new Set([
  'hash',
  'hashes',
  'id',
  'ids',
  'count',
  'counts',
  'at',
  'expiry',
  'expires',
  'expiration',
  'ttl',
  'length',
  'type',
  'kind',
  'name',
  'label',
  'enabled',
  'required',
  'configured',
  'present',
  'exists',
  'scope',
  'scopes',
  'version',
  'policy',
])

const SENSITIVE_KEY_PATTERN = new RegExp(
  `_(${SENSITIVE_KEY_TERMS.flatMap((term) => (
    term.includes('_') ? [term, term.replace(/_/g, '')] : [term]
  )).join('|')})_`,
)

export type AuditRedactionResult<T> = {
  value: T
  redacted: boolean
}

type MutableRedactionResult = {
  value: unknown
  redacted: boolean
}

function tokenizeAuditKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1_$2')
    .replace(/([0-9])([a-zA-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function isSensitiveAuditKey(key: string): boolean {
  const tokens = tokenizeAuditKey(key)
  if (tokens.length === 0) return false
  if (DERIVED_ATTRIBUTE_SUFFIXES.has(tokens[tokens.length - 1])) return false
  return SENSITIVE_KEY_PATTERN.test(`_${tokens.join('_')}_`)
}

function redactValue(
  input: unknown,
  seen: WeakMap<object, MutableRedactionResult>,
): MutableRedactionResult {
  if (!input || typeof input !== 'object' || input instanceof Date) {
    return { value: input, redacted: false }
  }

  const cached = seen.get(input)
  if (cached) return cached

  if (Array.isArray(input)) {
    const output: unknown[] = []
    const result: MutableRedactionResult = { value: output, redacted: false }
    seen.set(input, result)
    for (const item of input) {
      const child = redactValue(item, seen)
      output.push(child.value)
      result.redacted = result.redacted || child.redacted
    }
    return result
  }

  const output: Record<string, unknown> = {}
  const result: MutableRedactionResult = { value: output, redacted: false }
  seen.set(input, result)
  for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveAuditKey(key)) {
      output[key] = AUDIT_REDACTED_VALUE
      result.redacted = result.redacted || item !== AUDIT_REDACTED_VALUE
      continue
    }
    const child = redactValue(item, seen)
    output[key] = child.value
    result.redacted = result.redacted || child.redacted
  }
  return result
}

export function redactSensitiveAuditData<T>(input: T): AuditRedactionResult<T> {
  return redactValue(input, new WeakMap()) as AuditRedactionResult<T>
}

export function containsSensitiveAuditData(input: unknown): boolean {
  return redactSensitiveAuditData(input).redacted
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  return input as Record<string, unknown>
}

export function markAuditRedoUnavailable(payload: unknown): Record<string, unknown> {
  const existing = asRecord(payload)
  const safePayload = existing ? { ...existing } : {}
  delete safePayload.__redoInput
  safePayload[AUDIT_REDO_UNAVAILABLE_KEY] = AUDIT_REDO_UNAVAILABLE_REASON
  return safePayload
}

export function isAuditRedoUnavailable(payload: unknown): boolean {
  const record = asRecord(payload)
  return record?.[AUDIT_REDO_UNAVAILABLE_KEY] === AUDIT_REDO_UNAVAILABLE_REASON
}
