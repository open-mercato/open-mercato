function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readContextId(context: unknown, ...keys: string[]): string | null {
  if (!isRecord(context)) return null
  for (const key of keys) {
    const value = context[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0 && trimmed.length <= 200) return trimmed
    }
  }
  return null
}

export function readContextStringList(context: unknown, key: string): string[] {
  if (!isRecord(context)) return []
  const value = context[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}
