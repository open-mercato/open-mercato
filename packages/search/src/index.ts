/**
 * @open-mercato/search
 *
 * Pluggable search module with multiple strategy support:
 * - TokenSearchStrategy: Hash-based search for encrypted data
 * - VectorSearchStrategy: Semantic AI-powered search
 * - FullTextSearchStrategy: Full-text fuzzy search with pluggable drivers (Meilisearch, Algolia, etc.)
 *
 * @example
 * ```typescript
 * import { SearchService } from '@open-mercato/search'
 *
 * const results = await searchService.search('john doe', {
 *   tenantId: 'tenant-123',
 *   entityTypes: ['customers:customer_person_profile'],
 * })
 * ```
 */

// Re-export types
export * from './types'

// Service
export { SearchService } from './service'

// Strategies
export * from './strategies'

// Lib utilities
export * from './lib'

// Indexer
export * from './indexer'

// Fulltext driver registry (provider packages register their drivers here)
export {
  FULLTEXT_DRIVER_ENV,
  getFulltextDriverFactory,
  listFulltextDriverFactories,
  registerFulltextDriverFactory,
  resolveFulltextDriverId,
  resolveFulltextDriverSelection,
  type FulltextDriverDescriptor,
  type FulltextDriverEnvVar,
  type FulltextDriverFactory,
  type FulltextDriverSelection,
} from './fulltext/drivers/registry'
export type {
  FullTextSearchDriver,
  FullTextSearchDriverConfig,
  FullTextSearchDriverId,
  FullTextSearchDocument,
  FullTextSearchQuery,
  FullTextSearchHit,
} from './fulltext/types'

// DI registration
export { registerSearchModule, addSearchStrategy, type SearchContainer, type SearchModuleOptions } from './di'
