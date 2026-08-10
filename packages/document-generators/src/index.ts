export { metadata } from './modules/document_generators/index'

// Public API for external template authors
export { templateRegistry } from './modules/document_generators/lib/template-registry'
export type {
  TemplateEntry,
  TemplateRegistryEntry,
  TemplateMeta,
  TemplateFilter,
  TemplateLoadContext,
  TemplateDataContext,
} from './modules/document_generators/lib/interfaces'
export { BaseDocumentService, PdfRenderingService } from './modules/document_generators/services'
export type { DocumentTemplateEntry } from './modules/document_generators/services'
export type {
  DocumentTemplateSource,
  LoadedDocumentTemplateBase,
  LoadedPdfTemplate,
  LoadedTemplate,
  ReactPdfTemplateSource,
  RenderedDocument,
} from './modules/document_generators/lib/interfaces'
export { TemplatesList } from './modules/document_generators/components/TemplatesList'
export { formatDate } from './modules/document_generators/utils/formatDate'
// Shared PDF UI — import in external templates to get Inter font + brand components
export { colors as sharedColors, borders, spacing } from './modules/document_generators/templates/shared/theme'
export { OpenMercatoLogo } from './modules/document_generators/templates/shared/components/Logo'
