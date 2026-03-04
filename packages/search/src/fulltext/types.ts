import type { EntityId } from '@open-mercato/shared/modules/entities'
import type {
  SearchResultPresenter,
  SearchResultLink,
  SearchFieldPolicy,
} from '@open-mercato/shared/modules/search'
import type { EncryptionMapEntry } from '../lib/field-policy'

// =============================================================================
// Driver Identifiers
// =============================================================================

export type FullTextSearchDriverId =
  | 'meilisearch'
  | 'algolia'
  | 'elasticsearch'
  | 'typesense'
  | (string & {})

// =============================================================================
// Document Types (for indexing)
// =============================================================================

export type FullTextSearchDocument = {
  recordId: string
  entityId: EntityId
  tenantId: string
  organizationId?: string | null
  fields: Record<string, unknown>
  presenter?: SearchResultPresenter
  url?: string
  links?: SearchResultLink[]
}

// =============================================================================
// Query Types
// =============================================================================

export type FullTextSearchQuery = {
  tenantId: string
  organizationId?: string | null
  entityTypes?: EntityId[]
  limit?: number
  offset?: number
}

// =============================================================================
// Result Types
// =============================================================================

export type FullTextSearchHit = {
  recordId: string
  entityId: EntityId
  score: number
  presenter?: SearchResultPresenter
  url?: string
  links?: SearchResultLink[]
  metadata?: Record<string, unknown>
}

export type DocumentLookupKey = {
  entityId: EntityId
  recordId: string
}

export type IndexStats = {
  numberOfDocuments: number
  isIndexing: boolean
  fieldDistribution: Record<string, number>
}

// =============================================================================
// Driver Configuration
// =============================================================================

export type FullTextSearchDriverConfig = {
  encryptionMapResolver?: (entityId: EntityId) => Promise<EncryptionMapEntry[]>
  fieldPolicyResolver?: (entityId: EntityId) => SearchFieldPolicy | undefined
  defaultLimit?: number
}

// =============================================================================
// Driver Interface
// =============================================================================

export interface FullTextSearchDriver {
  readonly id: FullTextSearchDriverId

  // Lifecycle methods (mandatory)
  ensureReady(): Promise<void>
  isHealthy(): Promise<boolean>

  // Core operations (mandatory)
  search(query: string, options: FullTextSearchQuery): Promise<FullTextSearchHit[]>
  index(doc: FullTextSearchDocument): Promise<void>
  delete(recordId: string, tenantId: string): Promise<void>

  // Batch operations (optional)
  bulkIndex?(docs: FullTextSearchDocument[]): Promise<void>
  purge?(entityId: EntityId, tenantId: string): Promise<void>

  // Index management (optional)
  clearIndex?(tenantId: string): Promise<void>
  recreateIndex?(tenantId: string): Promise<void>

  // Document retrieval for enrichment (optional)
  getDocuments?(
    ids: DocumentLookupKey[],
    tenantId: string
  ): Promise<Map<string, FullTextSearchHit>>

  // Stats/admin (optional)
  getIndexStats?(tenantId: string): Promise<IndexStats | null>
  getEntityCounts?(tenantId: string): Promise<Record<string, number> | null>
}
