import type { DocumentTemplateSource } from '../lib/interfaces'

/**
 * Registration shape for a single template within a document service.
 * Does not include resourceKind or fromRecord — those are supplied by the service itself.
 */
export interface DocumentTemplateEntry {
  id: string
  label: string
  description: string
  documentType: string
  tags: string[]
  note?: string
  load: () => Promise<DocumentTemplateSource>
}
