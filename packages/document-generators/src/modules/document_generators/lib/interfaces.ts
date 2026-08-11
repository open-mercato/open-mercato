import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export type DocumentFormat = 'pdf' | 'md'

/** UI-facing metadata for a document template — used in listings and filtering. */
export interface TemplateMeta {
  id: string
  label: string
  description: string
  module: string          // top-level module — e.g. 'sales'
  resourceKind: string    // framework resource kind — e.g. 'sales.quote' | 'sales.order'
  documentType: string    // document kind — e.g. 'offer' | 'invoice' | 'contract'
  format?: DocumentFormat // optional for backwards compatibility; omitted entries are PDF
  tags: string[]
  note?: string           // free-text note — e.g. where the template is used or registered
}

/** React-PDF source loaded lazily by a PDF template entry. */
export interface ReactPdfTemplateSource {
  type: 'react-pdf'
  component: React.ComponentType<{ data: Record<string, unknown> }>
}

/** Markdown source rendered lazily from normalized template data. */
export interface MarkdownTemplateSource {
  type: 'markdown'
  render: (data: Record<string, unknown>) => string | Promise<string>
}

/** Union of format-specific template sources supported by the registry. */
export type DocumentTemplateSource = ReactPdfTemplateSource | MarkdownTemplateSource

/** Request-derived context available while normalizing a record for a template. */
export interface TemplateDataContext {
  locale: string
  translate?: TranslateFn
}

/** Context required to fetch, normalize, and load a template. */
export interface TemplateLoadContext {
  container: AppContainer
  auth: AuthContext | null
  locale: string
  translate?: TranslateFn
}

/** Runtime handlers for a document template — normalization, lazy loading, and optional server-side data fetching. */
export interface TemplateRegistryEntry {
  fromRecord: (data: unknown, context: TemplateDataContext) => Record<string, unknown> // maps enriched server data to the flat shape expected by the template component
  filename: (input: { data: Record<string, unknown> }) => string // derives the output filename from normalized data
  resourceId?: (input: { data: Record<string, unknown> }) => string | undefined // derives the canonical source record id from normalized server-side data
  resourceLabel?: (input: { data: Record<string, unknown> }) => string | undefined // derives a human-readable label for history from normalized data
  load: () => Promise<DocumentTemplateSource> // lazy-loaded format-specific template source
  fetchData?: (input: { data: unknown }, ctx: { container: AppContainer; auth: AuthContext | null }) => Promise<unknown> // server-side hook; called before normalization to fetch related data
}

/** Full template descriptor — UI metadata combined with runtime handlers. */
export type TemplateEntry = TemplateMeta & TemplateRegistryEntry

/** Filter criteria for querying templates from the registry. */
export interface TemplateFilter {
  resourceKind?: string
  documentType?: string
  format?: DocumentFormat
  tags?: string[]
}

/** Input accepted by the PDF renderer. */
export interface PdfRenderInput {
  format: 'pdf'
  source: ReactPdfTemplateSource
  data: Record<string, unknown>
}

/** Input accepted by the Markdown renderer. */
export interface MarkdownRenderInput {
  format: 'md'
  source: MarkdownTemplateSource
  data: Record<string, unknown>
}

/** Format-specific input accepted by the document renderer. */
export type DocumentRenderInput = PdfRenderInput | MarkdownRenderInput

/** Format-independent result returned by document renderers. */
export interface DocumentRenderOutput {
  buffer: Uint8Array
  format: DocumentFormat
  mimeType: string
}

/** Format-independent metadata shared by loaded templates. */
export interface LoadedDocumentTemplateBase {
  filename: string
  template: {
    id: string
    label: string
  }
  resource: {
    kind: string
    id?: string
    label?: string
  }
}

/** Loaded template carrying a PDF render request and output metadata. */
export interface LoadedPdfTemplate extends LoadedDocumentTemplateBase {
  render: PdfRenderInput
}

/** Loaded template carrying a Markdown render request and output metadata. */
export interface LoadedMarkdownTemplate extends LoadedDocumentTemplateBase {
  render: MarkdownRenderInput
}

/** Union of formats currently supported by the template registry. */
export type LoadedTemplate = LoadedPdfTemplate | LoadedMarkdownTemplate

/** Complete result of rendering a prepared template to downloadable bytes. */
export interface RenderedDocument {
  buffer: Uint8Array
  filename: string
  format: string
  mimeType: string
  template: LoadedDocumentTemplateBase['template']
  resource: LoadedDocumentTemplateBase['resource']
}

/** Contract for the template registry — extracted for testability. */
export interface TemplateRegistry {
  registerInternal(entries: TemplateEntry[]): void
  registerExternal(entries: TemplateEntry[]): void
  listTemplates(): { internal: TemplateMeta[]; external: TemplateMeta[] }
  load(input: { id: string; data: unknown }, ctx: TemplateLoadContext): Promise<LoadedTemplate>
}
