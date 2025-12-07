import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'

export const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.filter((entry) => entry !== undefined)
  if (value === undefined) return null
  return value
}

export const prefixCustomFieldValues = (input?: Record<string, unknown> | null): Record<string, unknown> => {
  if (!input || typeof input !== 'object') return {}
  return Object.entries(input).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const trimmedKey = key.trim()
    if (!trimmedKey.length) return acc
    const normalizedKey = trimmedKey.startsWith('cf_')
      ? trimmedKey
      : trimmedKey.startsWith('cf:')
        ? `cf_${trimmedKey.slice(3)}`
        : `cf_${trimmedKey}`
    if (normalizedKey.endsWith('__is_multi')) return acc
    acc[normalizedKey] = value
    return acc
  }, {})
}

export const extractCustomFieldValues = (source?: Record<string, unknown> | null): Record<string, unknown> => {
  if (!source || typeof source !== 'object') return {}
  const merged: Record<string, unknown> = {}
  const assign = (key: unknown, value: unknown) => {
    if (typeof key !== 'string') return
    const trimmed = key.trim()
    if (!trimmed.length) return
    const normalizedKey = trimmed.startsWith('cf_')
      ? trimmed
      : trimmed.startsWith('cf:')
        ? `cf_${trimmed.slice(3)}`
        : `cf_${trimmed}`
    if (normalizedKey.endsWith('__is_multi')) return
    merged[normalizedKey] = value
  }

  Object.entries(source).forEach(([key, value]) => {
    if (key.startsWith('cf_') || key.startsWith('cf:')) {
      assign(key, value)
    }
  })

  const customValues = (source as any).customValues ?? (source as any).custom_values
  if (customValues && typeof customValues === 'object' && !Array.isArray(customValues)) {
    Object.entries(customValues as Record<string, unknown>).forEach(([key, value]) => assign(key, value))
  }

  const customFields = (source as any).customFields ?? (source as any).custom_fields
  if (Array.isArray(customFields)) {
    ;(customFields as Array<Record<string, unknown>>).forEach((entry) => {
      const key =
        typeof entry?.key === 'string'
          ? entry.key
          : typeof (entry as any)?.id === 'string'
            ? (entry as any).id
            : null
      if (!key) return
      assign(key, (entry as any)?.value)
    })
  } else if (customFields && typeof customFields === 'object') {
    Object.entries(customFields as Record<string, unknown>).forEach(([key, value]) => assign(key, value))
  }

  const normalized = normalizeCustomFieldResponse(merged)
  return normalized ? prefixCustomFieldValues(normalized) : prefixCustomFieldValues(merged)
}
