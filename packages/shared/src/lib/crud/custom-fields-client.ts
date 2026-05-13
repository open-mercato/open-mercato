export function extractCustomFieldEntries(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!item || typeof item !== 'object') return out

  const normalizeValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed.slice(1, -1).trim()
      if (!inner) return []
      return inner.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean)
    }
    return trimmed
  }

  const assign = (rawKey: unknown, rawValue: unknown) => {
    if (typeof rawKey !== 'string') return
    const trimmed = rawKey.trim()
    if (!trimmed) return
    out[`cf_${trimmed}`] = normalizeValue(rawValue)
  }

  const assignObject = (source: unknown) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      assign(key, value)
    }
  }

  const assignEntries = (source: unknown) => {
    if (!Array.isArray(source)) return
    for (const entry of source as Array<Record<string, unknown>>) {
      if (!entry || typeof entry !== 'object') continue
      const key = typeof entry.key === 'string'
        ? entry.key
        : typeof entry.id === 'string'
          ? entry.id
          : null
      if (!key) continue
      assign(key, 'value' in entry ? (entry as any).value : undefined)
    }
  }

  for (const [rawKey, rawValue] of Object.entries(item)) {
    if (rawKey.startsWith('cf_')) {
      if (rawKey.endsWith('__is_multi')) continue
      out[rawKey] = normalizeValue(rawValue)
    } else if (rawKey.startsWith('cf:')) {
      assign(rawKey.slice(3), rawValue)
    }
  }

  assignObject((item as any).customValues)
  assignObject((item as any).custom_values)
  assignObject((item as any).customFields)
  assignObject((item as any).custom_fields)
  assignEntries((item as any).customFields)
  assignEntries((item as any).custom_fields)
  assignEntries((item as any).customFieldEntries)
  assignEntries((item as any).custom_field_entries)

  return out
}
