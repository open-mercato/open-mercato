import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type {
  DocumentTemplateSource,
  TemplateEntry,
  TemplateMeta,
} from '@open-mercato/shared/modules/document-generators'

export interface TemplateLoadContext {
  container: AppContainer
  auth: AuthContext | null
  locale: string
  translate?: TranslateFn
}

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

export interface LoadedDocumentTemplateBase {
  filename: string
  template: { id: string; label: string }
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

export interface TemplateRegistry {
  register(entries: TemplateEntry[]): void
  listTemplates(filter?: TemplateFilter, translate?: TranslateFn): TemplateMeta[]
  listTemplateFilterOptions(templates?: TemplateMeta[]): TemplateFilterOptions
  load(input: { id: string; data: unknown }, context: TemplateLoadContext): Promise<LoadedTemplate>
}
