/**
 * Coerce an arbitrary `displayName` payload to a string for safe UI consumption.
 *
 * The encryption pipeline used to coerce numeric-looking string display names
 * back into numbers (issue #1734). The root cause is fixed in
 * `parseDecryptedFieldValue`, but this helper remains as belt-and-suspenders
 * for any persisted data that was already corrupted on read paths that bypass
 * the new heuristic.
 */
export function coerceDisplayName(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

export function coerceDisplayNameOrNull(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  return String(value)
}

export function deriveDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const first = (firstName ?? '').trim()
  const last = (lastName ?? '').trim()
  return [first, last].filter((part) => part.length > 0).join(' ').trim()
}

export function isDerivedDisplayName(
  current: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): boolean {
  const trimmed = (current ?? '').trim()
  if (trimmed.length === 0) return true
  return trimmed === deriveDisplayName(firstName, lastName)
}

export function deriveDisplayNameFromEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null
  const trimmed = email.trim()
  if (!trimmed.length) return null
  const atIndex = trimmed.indexOf('@')
  const localPart = (atIndex >= 0 ? trimmed.slice(0, atIndex) : trimmed).trim()
  if (!localPart.length) return null
  const segments = localPart
    .split(/[._\-+]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (segments.length === 0) return null
  return segments
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(' ')
}
