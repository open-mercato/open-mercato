import type {
  DocumentFetchContext,
  DocumentTemplateSource,
  TemplateDataContext,
} from '@open-mercato/shared/modules/document-generators'

export interface TemplateFilter {
  resourceKind?: string
  documentType?: string
  format?: string
  tags?: string[]
}

export interface TemplateFilterOptions {
  resourceKinds: string[]
  formats: string[]
}

export type TemplateLoadContext = DocumentFetchContext & TemplateDataContext

export interface DocumentRenderInput {
  format: string
  source: DocumentTemplateSource
  data: Record<string, unknown>
}

export interface DocumentRenderOutput {
  buffer: Uint8Array
  format: string
  mimeType: string
}

export interface DocumentRenderingService {
  render(input: DocumentRenderInput): Promise<DocumentRenderOutput>
}

export interface LoadedDocumentTemplateBase {
  data: Record<string, unknown>
  filename: string
  template: { id: string; label: string; version: string }
  resource: { kind: string; id: string; label?: string }
}

export interface LoadedTemplate extends LoadedDocumentTemplateBase {
  render: DocumentRenderInput
}

export interface RenderedDocument {
  buffer: Uint8Array
  filename: string
  format: string
  mimeType: string
  template: LoadedDocumentTemplateBase['template']
  resource: LoadedDocumentTemplateBase['resource']
}
