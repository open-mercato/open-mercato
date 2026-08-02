export { toOptionalString } from './string/coerce'

export function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function parseCommaSeparatedList(value: string | null | undefined): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

