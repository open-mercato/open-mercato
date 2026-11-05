export function toOptionalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return null
}
