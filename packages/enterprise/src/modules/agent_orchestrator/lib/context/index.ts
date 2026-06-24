export {
  ContextResolverImpl,
  ContextModuleNotFoundError,
  assembleInputSchema,
} from './contextResolver'
export type {
  ContextResolver,
  AssembleInput,
  AssembleResult,
  RetrieveScope,
  RetrievedSnippet,
} from './contextResolver'
export {
  registerContextModule,
  resolveContextModule,
  listContextCapabilities,
  entityProvenance,
  retrievalProvenance,
} from './registry'
export type {
  ContextModule,
  ContextSourceDecl,
  ContextSourceHit,
} from './registry'
export { estimateTokens, packCandidates } from './packer'
export type { PackCandidate, PackResult } from './packer'
export { readRetrievalSource } from './retrievalSource'
export type { SearchServiceLike, SearchHit, RetrievalScope } from './retrievalSource'
export {
  OpenAiVisionOcrProvider,
  resolveDefaultOcrProvider,
} from './documentOcrProvider'
export type {
  DocumentOcrProvider,
  DocumentOcrInput,
  DocumentOcrResult,
  DocumentOcrBlock,
  DocumentOcrScope,
  OcrServiceLike,
} from './documentOcrProvider'
export {
  DocumentIngestServiceImpl,
  defaultDocumentClassifier,
  defaultDocumentFieldExtractor,
  formatDocumentLocator,
} from './documentIngest'
export type {
  DocumentIngestService,
  DocumentIngestInput,
  DocumentIngestOptions,
  DocumentClassifier,
  DocumentFieldExtractor,
} from './documentIngest'
export {
  documentExtractionToCandidates,
  documentProvenance,
  documentFactId,
  DEFAULT_DOCUMENT_MIN_CONFIDENCE,
} from './documentSource'
export type { DocumentSourceCandidate, DocumentSourceOptions } from './documentSource'
