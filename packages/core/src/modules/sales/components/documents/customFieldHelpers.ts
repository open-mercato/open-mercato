import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'

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
  const extracted = extractCustomFieldEntries(source)
  const normalized = normalizeCustomFieldResponse(extracted)
  return normalized ? prefixCustomFieldValues(normalized) : prefixCustomFieldValues(extracted)
}
