import type { DocumentFormat, DocumentTemplateSource } from '../lib/interfaces'

/**
 * Registration shape for a single template within a document service.
 * Does not include resourceKind or fromRecord — those are supplied by the service itself.
 */
export interface DocumentTemplateEntry {
  id: string
  label: string
  description: string
  documentType: string
  format?: DocumentFormat
  tags: string[]
  note?: string
  filename?: (input: { data: Record<string, unknown> }) => string
  load: () => Promise<DocumentTemplateSource>
}
