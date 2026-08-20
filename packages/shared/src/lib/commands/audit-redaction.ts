export const AUDIT_REDACTED_VALUE = '[REDACTED]'
export const AUDIT_REDO_UNAVAILABLE_KEY = '__redoUnavailable'
export const AUDIT_REDO_UNAVAILABLE_REASON = 'sensitive-data-redacted'

const SENSITIVE_KEY_SUFFIXES = [
  'password',
  'passwords',
  'passphrase',
  'passphrases',
  'secret',
  'secrets',
  'token',
  'tokens',
  'apikey',
  'apikeys',
  'privatekey',
  'privatekeys',
  'recoverycode',
  'recoverycodes',
  'credential',
  'credentials',
  'authorization',
  'authorizationheader',
  'authheader',
  'cookie',
  'cookies',
  'otp',
  'otps',
  'otpcode',
  'otpcodes',
  'otpseed',
] as const

export type AuditRedactionResult<T> = {
  value: T
  redacted: boolean
}

type MutableRedactionResult = {
  value: unknown
  redacted: boolean
}

function normalizeAuditKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function isSensitiveAuditKey(key: string): boolean {
  const normalized = normalizeAuditKey(key)
  if (!normalized || normalized.endsWith('hash')) return false
  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
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
