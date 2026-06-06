import { createHash } from 'node:crypto'

const SENSITIVE_KEY_PATTERN = /(secret|token|password|private|credential|encryption|fallback|api[_-]?key|database_url|redis_url)/i
const CREDENTIAL_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
]

export function fingerprintSecret(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 8)}`
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

export function detectCredentialValue(value: string, railwayToken?: string): boolean {
  if (railwayToken && value.includes(railwayToken)) return true
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value))
}

export function assertSafeVariables(
  variables: Record<string, string>,
  options: { railwayToken?: string; allowedKeys?: string[] } = {},
): void {
  const allowedKeys = new Set(options.allowedKeys ?? [])
  for (const [key, value] of Object.entries(variables)) {
    if (!allowedKeys.has(key) && detectCredentialValue(value, options.railwayToken)) {
      throw new Error(
        `Refusing to upload credential-like value from ${key}. Pass --allow-secret-passthrough ${key} to allow this exact key.`,
      )
    }
  }
}

export function formatVariableValue(key: string, value: string, railwayToken?: string): string {
  if (isSensitiveKey(key) || detectCredentialValue(value, railwayToken)) {
    return `<redacted> (${fingerprintSecret(value)})`
  }
  return value
}

export function redactText(value: string, secrets: string[] = []): string {
  let redacted = value
  for (const secret of secrets.filter(Boolean).sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(secret).join('****')
  }
  for (const pattern of CREDENTIAL_PATTERNS) {
    redacted = redacted.replace(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`), '****')
  }
  return redacted.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer ****')
}

export function redactStructuredValue(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === 'string') return redactText(value, secrets)
  if (Array.isArray(value)) {
    return value.map((item) => redactStructuredValue(item, secrets))
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      isSensitiveKey(key) ? '<redacted>' : redactStructuredValue(nestedValue, secrets),
    ]),
  )
}

export function collectSensitiveStructuredValues(value: unknown): string[] {
  const collected = new Set<string>()

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (!current || typeof current !== 'object') return
    for (const [key, nestedValue] of Object.entries(current as Record<string, unknown>)) {
      if (isSensitiveKey(key) && typeof nestedValue === 'string' && nestedValue.length > 0) {
        collected.add(nestedValue)
      } else {
        visit(nestedValue)
      }
    }
  }

  visit(value)
  return Array.from(collected)
}
