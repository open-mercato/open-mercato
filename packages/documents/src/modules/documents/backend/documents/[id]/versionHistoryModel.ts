import {
  firstSafeDocumentsDisplayLabel,
} from '../../../lib/displayLabels'
import { sanitizeDocumentVersionLabel } from '../../../lib/versionLabels'
import { readRecord, readString } from '../documentUi'

export type DocumentVersion = {
  id: string
  label: string | null
  creatorLabel: string
  createdAt: string
}

export function normalizeVersion(value: unknown, fallbackCreatorLabel?: string): DocumentVersion | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const createdAt = readString(record, 'createdAt', 'created_at')
  if (!id || !createdAt) return null
  return {
    id,
    createdAt,
    label: sanitizeDocumentVersionLabel(readString(record, 'label')),
    creatorLabel: firstSafeDocumentsDisplayLabel(
      readString(record, 'creatorLabel', 'createdByLabel', 'created_by_label'),
      fallbackCreatorLabel,
    ) ?? '',
  }
}
