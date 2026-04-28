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
