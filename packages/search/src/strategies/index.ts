export { TokenSearchStrategy, type TokenStrategyConfig } from './token.strategy'
export { VectorSearchStrategy, type VectorStrategyConfig, type EmbeddingService } from './vector.strategy'
export { FullTextSearchStrategy } from './fulltext.strategy'
export {
  buildIndexDocFilterExists,
  buildIndexDocFilterPredicate,
  compileIndexDocFilterExists,
  INDEX_DOC_FILTER_ALIAS,
  type IndexDocFilterTarget,
} from '../lib/index-doc-filter'

// Re-export fulltext driver types for convenience
export type {
  FullTextSearchDriver,
  FullTextSearchDriverId,
  FullTextSearchDocument,
  FullTextSearchQuery,
  FullTextSearchHit,
  FullTextSearchDriverConfig,
  DocumentLookupKey,
  IndexStats,
} from '../fulltext/types'
export { createMeilisearchDriver, createFulltextDriver } from '../fulltext/drivers'
export type { MeilisearchDriverOptions } from '../fulltext/drivers/meilisearch'
