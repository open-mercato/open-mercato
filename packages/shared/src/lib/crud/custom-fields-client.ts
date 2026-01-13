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

  for (const [rawKey, rawValue] of Object.entries(item)) {
    if (rawKey.startsWith('cf_')) {
      if (rawKey.endsWith('__is_multi')) continue
      out[rawKey] = normalizeValue(rawValue)
    } else if (rawKey.startsWith('cf:')) {
      assign(rawKey.slice(3), rawValue)
    }
  }

  const customValues = (item as any).customValues
  if (customValues && typeof customValues === 'object' && !Array.isArray(customValues)) {
    for (const [key, value] of Object.entries(customValues as Record<string, unknown>)) {
      assign(key, value)
    }
  }

  const customFields = (item as any).customFields
  if (Array.isArray(customFields)) {
    for (const entry of customFields as Array<Record<string, unknown>>) {
      const key = entry && typeof entry.key === 'string' ? entry.key : null
      if (!key) continue
      assign(key, 'value' in entry ? (entry as any).value : undefined)
    }
  } else if (customFields && typeof customFields === 'object') {
    for (const [key, value] of Object.entries(customFields as Record<string, unknown>)) {
      assign(key, value)
    }
  }

  return out
}
