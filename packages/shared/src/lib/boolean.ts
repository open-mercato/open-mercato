export const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enable', 'enabled'])
export const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disable', 'disabled'])

export function parseBooleanToken(raw: string | null | undefined): boolean | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return null
}

export function parseBooleanWithDefault(raw: string | null | undefined, fallback: boolean): boolean {
  const parsed = parseBooleanToken(raw)
  return parsed === null ? fallback : parsed
}
