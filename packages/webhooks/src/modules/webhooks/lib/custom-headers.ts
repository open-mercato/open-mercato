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
