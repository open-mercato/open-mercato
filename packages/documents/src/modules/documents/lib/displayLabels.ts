/**
 * Canonical UUIDs are internal identifiers, regardless of their version nibble.
 * A system-owned display label containing one is unsafe because even otherwise
 * readable text can accidentally expose a record id (for example
 * `Customer 123e4567-e89b-12d3-a456-426614174000`).
 */
const CANONICAL_UUID_ANYWHERE_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export function containsCanonicalUuid(value: unknown): boolean {
  return typeof value === 'string' && CANONICAL_UUID_ANYWHERE_PATTERN.test(value)
}

/**
 * Normalize a candidate that will be rendered as a system-owned label.
 * Document prose is intentionally outside this boundary and is never censored.
 */
export function sanitizeDocumentsDisplayLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || containsCanonicalUuid(normalized)) return null
  return normalized
}

export function firstSafeDocumentsDisplayLabel(...values: unknown[]): string | null {
  for (const value of values) {
    const safe = sanitizeDocumentsDisplayLabel(value)
    if (safe) return safe
  }
  return null
}
