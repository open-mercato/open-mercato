function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

function formatObjectSummary(record: Record<string, unknown>): string | null {
  const personName = [readString(record, 'firstName'), readString(record, 'lastName')]
    .filter(Boolean)
    .join(' ')
    .trim()
  const label = readString(record, 'displayName', 'label', 'name', 'title', 'fullName')
    ?? (personName || null)
    ?? readString(record, 'email')
  if (!label) return null
  return record.isPrimary === true ? `${label} (primary)` : label
}

export function formatChangelogValue(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return value
      .map((entry) => formatChangelogValue(entry))
      .filter(Boolean)
      .join(', ')
  }
  if (isRecord(value)) {
    const summary = formatObjectSummary(value)
    if (summary) return summary
    return JSON.stringify(value)
  }
  return String(value)
}
