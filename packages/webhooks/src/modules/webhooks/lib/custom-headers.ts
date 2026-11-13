const RESERVED_HEADER_PREFIX = 'webhook-'
const RESERVED_HEADER_NAMES = new Set(['content-type'])

export function isReservedWebhookCustomHeader(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return normalized.startsWith(RESERVED_HEADER_PREFIX) || RESERVED_HEADER_NAMES.has(normalized)
}

export function sanitizeWebhookCustomHeaders(
  customHeaders: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!customHeaders) return {}
  return Object.fromEntries(
    Object.entries(customHeaders).filter(([name]) => !isReservedWebhookCustomHeader(name)),
  )
}

export const WEBHOOK_REDACTED_HEADER_VALUE = '••••••••'

const CREDENTIAL_HEADER_NAME_PATTERN = /(auth|token|secret|pass|pwd|key|credential|sig|hmac|session|cookie|jwt|bearer|private)/i
const CREDENTIAL_HEADER_VALUE_PATTERN = /^(?:(?:bearer|basic|digest|token)\s|eyJ|sk_(?:live|test)_|rk_(?:live|test)_|gh[pousr]_|github_pat_|xox[abpr]-|glpat-)/i

export function isCredentialWebhookHeader(name: string, value?: string | null): boolean {
  if (CREDENTIAL_HEADER_NAME_PATTERN.test(name.trim())) return true
  return typeof value === 'string' && CREDENTIAL_HEADER_VALUE_PATTERN.test(value.trim())
}

export function redactWebhookCustomHeaders(
  customHeaders: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!customHeaders) return null
  return Object.fromEntries(
    Object.entries(customHeaders).map(([name, value]) => [
      name,
      isCredentialWebhookHeader(name, value) ? WEBHOOK_REDACTED_HEADER_VALUE : value,
    ]),
  )
}

export type ResolvedWebhookCustomHeaders =
  | { ok: true; headers: Record<string, string>; keptStoredValues: string[] }
  | { ok: false; header: string }

function findStoredHeaderValue(name: string, stored: Record<string, string>): string | null {
  if (Object.prototype.hasOwnProperty.call(stored, name)) return stored[name]
  const normalized = name.trim().toLowerCase()
  const matches = Object.keys(stored).filter((storedName) => storedName.trim().toLowerCase() === normalized)
  return matches.length === 1 ? stored[matches[0]] : null
}

export function resolveRedactedWebhookCustomHeaders(
  next: Record<string, string>,
  stored: Record<string, string> | null | undefined,
): ResolvedWebhookCustomHeaders {
  const headers: Record<string, string> = {}
  const keptStoredValues: string[] = []
  for (const [name, value] of Object.entries(next)) {
    if (value !== WEBHOOK_REDACTED_HEADER_VALUE) {
      headers[name] = value
      continue
    }
    const storedValue = stored ? findStoredHeaderValue(name, stored) : null
    if (storedValue === null || storedValue === WEBHOOK_REDACTED_HEADER_VALUE) return { ok: false, header: name }
    headers[name] = storedValue
    if (isCredentialWebhookHeader(name, storedValue)) keptStoredValues.push(name)
  }
  return { ok: true, headers, keptStoredValues }
}

export type WebhookCustomHeadersUpdate =
  | { ok: true; customHeaders: Record<string, string> | null | undefined }
  | { ok: false; reason: 'redactedHeaderWithoutValue' | 'credentialHeadersRequireReentry'; header: string }

export function planWebhookCustomHeadersUpdate(input: {
  current: { url: string; customHeaders?: Record<string, string> | null }
  next: { url?: string; customHeaders?: Record<string, string> | null }
  canRevealCredentials: boolean
}): WebhookCustomHeadersUpdate {
  const { current, next, canRevealCredentials } = input
  let customHeaders: Record<string, string> | null | undefined = next.customHeaders
  let keptCredentialHeaders: string[] = []

  if (next.customHeaders === undefined) {
    keptCredentialHeaders = Object.entries(current.customHeaders ?? {})
      .filter(([name, value]) => isCredentialWebhookHeader(name, value))
      .map(([name]) => name)
  } else if (next.customHeaders !== null) {
    const resolved = resolveRedactedWebhookCustomHeaders(next.customHeaders, current.customHeaders)
    if (!resolved.ok) return { ok: false, reason: 'redactedHeaderWithoutValue', header: resolved.header }
    customHeaders = resolved.headers
    keptCredentialHeaders = resolved.keptStoredValues
  }

  const urlChanged = next.url !== undefined && next.url !== current.url
  if (!canRevealCredentials && urlChanged && keptCredentialHeaders.length > 0) {
    return { ok: false, reason: 'credentialHeadersRequireReentry', header: keptCredentialHeaders[0] }
  }

  return { ok: true, customHeaders }
}
