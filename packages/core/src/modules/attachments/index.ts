import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'attachments',
  title: 'Attachments',
  version: '0.1.0',
  description: 'File attachments and media management.',
  author: 'Open Mercato Team',
  license: 'MIT',
}

export {
  type AttachmentOwner,
  type AttachmentProviderCleanup,
  type AttachmentService,
  type CreatedScopedAttachment,
  type CreateScopedAttachmentInput,
  type ReadScopedAttachmentInput,
  type ReadScopedAttachmentResult,
  type ReleaseScopedAttachmentInput,
} from './lib/attachment-service'

export {
  type AttachmentDocumentStructureService,
  type DocumentExtractionSummary,
  type DocumentOutlineNode,
  type DocumentSection,
  type DocumentStructure,
  type DocumentStructureAccessScope,
  type DocumentStructureStats,
  type GetDocumentNormalizedTextInput,
  type GetDocumentSectionInput,
  type GetDocumentStructureInput,
  type GetDocumentStructureStatsInput,
  type ListDocumentSectionsInput,
  type ListDocumentSectionsResult,
  type RequestDocumentExtractionInput,
  type RequestDocumentExtractionResult,
  type ResolveDocumentCitationInput,
  type ResolvedDocumentCitation,
} from './lib/documentStructure/service'

export type { DocumentStructureEngineRegistry } from './lib/documentStructure/engines/registry'

export type {
  DocumentOcrMode,
  DocumentSectionKind,
  DocumentSectionSource,
  DocumentStructureEngine,
  DocumentStructureEngineName,
  ExtractionSkipReason,
  ExtractionStatus,
} from './lib/documentStructure/types'
