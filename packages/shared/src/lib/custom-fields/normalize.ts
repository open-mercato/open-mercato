import type { DataEngine } from '../data/engine'

type CustomFieldValueInput = Parameters<DataEngine['setCustomFields']>[0]['values']

export function normalizeCustomFieldValues(values: Record<string, unknown>): CustomFieldValueInput {
  const result: CustomFieldValueInput = {}
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      result[key] = value.map((entry) => normalizePrimitive(entry)) as CustomFieldValueInput[string]
    } else {
      result[key] = normalizePrimitive(value)
    }
  }
  return result
}

function normalizePrimitive(value: unknown): CustomFieldValueInput[string] {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value as CustomFieldValueInput[string]
  }
  return String(value) as CustomFieldValueInput[string]
}

export function normalizeCustomFieldResponse(
  values: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!values) return undefined
  const entries: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (key.startsWith('cf_') || key.startsWith('cf:')) {
      const normalized = key.slice(3)
      if (normalized) entries[normalized] = value
      continue
    }
    entries[key] = value
  }
  return Object.keys(entries).length ? entries : undefined
}
