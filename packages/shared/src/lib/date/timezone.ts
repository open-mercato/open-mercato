/**
 * Returns the canonical IANA spelling of `value` (for example `europe/warsaw` → `Europe/Warsaw`),
 * or `null` when the runtime cannot resolve it as a time zone.
 */
export function canonicalizeTimeZone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

export function isValidTimeZone(value: string | null | undefined): value is string {
  return canonicalizeTimeZone(value) !== null
}
