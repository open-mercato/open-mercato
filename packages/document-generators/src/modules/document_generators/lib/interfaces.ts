import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

/** UI-facing metadata for a PDF template — used in listings and filtering. */
export interface TemplateMeta {
  id: string
  label: string
  description: string
  module: string          // top-level module — e.g. 'sales'
  resourceKind: string    // framework resource kind — e.g. 'sales.quote' | 'sales.order'
  documentType: string    // document kind — e.g. 'offer' | 'invoice' | 'contract'
  tags: string[]
  note?: string           // free-text note — e.g. where the template is used or registered
}

/** React-PDF source loaded lazily by a PDF template entry. */
export interface ReactPdfTemplateSource {
  type: 'react-pdf'
  component: React.ComponentType<{ data: Record<string, unknown> }>
}

/** Union of format-specific template sources supported by the registry. */
export type DocumentTemplateSource = ReactPdfTemplateSource

/** Request-derived context available while normalizing a record for a template. */
export interface TemplateDataContext {
  locale: string
}

/** Context required to fetch, normalize, and load a template. */
export interface TemplateLoadContext {
  container: AppContainer
  auth: AuthContext | null
  locale: string
}

/** Runtime handlers for a PDF template — normalization, lazy loading, and optional server-side data fetching. */
export interface TemplateRegistryEntry {
  fromRecord: (data: unknown, context: TemplateDataContext) => Record<string, unknown> // maps enriched server data to the flat shape expected by the template component
  filename: (input: { data: Record<string, unknown> }) => string // derives the PDF filename from normalized data
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
  tags?: string[]
}

/** Format-independent metadata and normalized data shared by loaded templates. */
export interface LoadedDocumentTemplateBase {
  data: Record<string, unknown>
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

/** Loaded React-PDF template accepted by {@link PdfRenderingService}. */
export interface LoadedPdfTemplate extends LoadedDocumentTemplateBase {
  source: ReactPdfTemplateSource
}

/** Union of formats currently supported by the template registry. */
export type LoadedTemplate = LoadedPdfTemplate

/** Complete result of rendering a prepared template to PDF bytes. */
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
