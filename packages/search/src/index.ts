/**
 * @open-mercato/search
 *
 * Pluggable search module with multiple strategy support:
 * - TokenSearchStrategy: Hash-based search for encrypted data
 * - VectorSearchStrategy: Semantic AI-powered search
 * - MeilisearchStrategy: Full-text fuzzy search
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

// Service will be exported here after implementation
// export { SearchService } from './service'

// Strategies will be exported here after implementation
// export * from './strategies'

// Lib utilities will be exported here after implementation
// export * from './lib'
