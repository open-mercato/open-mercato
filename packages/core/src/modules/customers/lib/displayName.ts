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
