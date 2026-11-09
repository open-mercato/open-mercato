import type { IndexableRecord } from '../types'
import { normalizeDefinitionKey } from '@open-mercato/shared/lib/crud/custom-field-definition-index'

export function plaintextSearchFields(record: IndexableRecord): Record<string, unknown> {
  const exclusion = record.plaintextExcludedCustomFields
  if (!exclusion || exclusion.length === 0) return record.fields
  const keys = exclusion === 'all' ? null : new Set(exclusion.flatMap((key) => {
    const normalized = normalizeDefinitionKey(key)
    return [normalized, normalized.replace(/[^a-z0-9_]/g, '_')]
  }))
  return Object.fromEntries(Object.entries(record.fields).filter(([key]) => {
    if (!key.startsWith('cf:') && !key.startsWith('cf_')) return true
    return keys !== null && !keys.has(normalizeDefinitionKey(key.slice(3)))
  }))
}
