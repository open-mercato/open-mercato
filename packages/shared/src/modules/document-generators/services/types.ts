import type { DocumentTemplateSource } from '../lib/interfaces'

export interface DocumentTemplateEntry {
  id: string
  label: string
  description: string
  documentType: string
  format: string
  tags: string[]
  note?: string
  filename?: (input: { data: Record<string, unknown> }) => string
  load: () => Promise<DocumentTemplateSource>
}
