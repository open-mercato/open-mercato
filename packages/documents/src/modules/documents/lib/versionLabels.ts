import { sanitizeDocumentsDisplayLabel } from './displayLabels'

export const DOCUMENT_VERSION_LABEL_MAX_LENGTH = 256

export function sanitizeDocumentVersionLabel(value: unknown): string | null {
  const label = sanitizeDocumentsDisplayLabel(value)
  if (!label || label.length > DOCUMENT_VERSION_LABEL_MAX_LENGTH) return null
  return label
}
