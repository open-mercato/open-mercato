export { metadata } from './modules/document_generators/index'

// Public API for external template authors
export { templateRegistry } from './modules/document_generators/lib/template-registry'
/** @deprecated Import from `@open-mercato/shared/modules/document-generators` instead. */
export { BaseDocumentService } from '@open-mercato/shared/modules/document-generators'
/** @deprecated Import these types from `@open-mercato/shared/modules/document-generators` instead. */
export type {
  DocumentTemplateEntry,
  DocumentTemplateSource,
  TemplateDataContext,
  TemplateEntry,
  TemplateMeta,
  TemplateRegistryEntry,
} from '@open-mercato/shared/modules/document-generators'
export type {
  DocumentRenderInput,
  DocumentRenderOutput,
  LoadedDocumentTemplateBase,
  LoadedTemplate,
  RenderedDocument,
  TemplateFilter,
  TemplateLoadContext,
  TemplateRegistry,
} from './modules/document_generators/lib/interfaces'
export {
  DocumentRenderer,
  MarkdownRenderingService,
  PdfRenderingService,
} from './modules/document_generators/services'
export { TemplatesList } from './modules/document_generators/components/TemplatesList'
export { formatDate } from './modules/document_generators/utils/formatDate'
// Shared PDF authoring tokens and brand components for external templates
export { colors as sharedColors, borders, spacing } from './modules/document_generators/templates/shared/theme'
export { OpenMercatoLogo } from './modules/document_generators/templates/shared/components/Logo'
