export { TokenSearchStrategy, type TokenStrategyConfig } from './token.strategy'
export { VectorSearchStrategy, type VectorStrategyConfig, type EmbeddingService } from './vector.strategy'
export { FullTextSearchStrategy } from './fulltext.strategy'

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
