import {
  firstSafeDocumentsDisplayLabel,
  sanitizeDocumentsDisplayLabel,
} from '../../../lib/displayLabels'
import {
  getEntityTokenFieldNames,
  type DocumentEntityType,
} from '../../../lib/entityRegistry'
import { readBoolean, readRecord, readString } from '../documentUi'

export type RelatedRecord = {
  id: string
  entityType: DocumentEntityType
  label: string
  href: string | null
  canOpen: boolean
  source: 'chip' | 'template' | 'related-panel'
  updatedAt: string
  values: Record<string, string | null>
}

export function normalizeRelatedRecord(value: unknown, fallbackLabel: string): RelatedRecord | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const entityType = readString(record, 'entityType', 'entity_type') as DocumentEntityType | null
  const label = firstSafeDocumentsDisplayLabel(readString(record, 'label'), fallbackLabel)
  const updatedAt = readString(record, 'updatedAt', 'updated_at')
  const source = readString(record, 'source') as RelatedRecord['source'] | null
  if (!id || !entityType || !label || !updatedAt || !source) return null
  const canOpen = readBoolean(record, 'canOpen', 'can_open') ?? false
  const rawValues = canOpen ? readRecord(record.values) : null
  const values = rawValues
    ? Object.fromEntries(Array.from(getEntityTokenFieldNames(entityType), (field) => [
        field,
        sanitizeDocumentsDisplayLabel(rawValues[field]),
      ]))
    : {}
  return {
    id,
    entityType,
    label,
    updatedAt,
    source,
    href: readString(record, 'href'),
    canOpen,
    values,
  }
}
