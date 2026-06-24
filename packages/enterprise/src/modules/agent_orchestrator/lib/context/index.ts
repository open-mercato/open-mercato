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
