import type { EntityId } from './entities'

// =============================================================================
// Strategy Identifiers
// =============================================================================

/**
 * Built-in strategy identifiers plus extensible string for third-party strategies.
 */
export type SearchStrategyId = 'tokens' | 'vector' | 'fulltext' | (string & {})

// =============================================================================
// Result Types
// =============================================================================

/**
 * Presenter metadata for displaying search results in UI (Cmd+K, global search).
 */
export type SearchResultPresenter = {
  title: string
  subtitle?: string
  icon?: string
  badge?: string
}

/**
 * Deep link rendered next to a search result.
 */
export type SearchResultLink = {
  href: string
  label: string
  kind?: 'primary' | 'secondary'
}

/**
 * A single search result returned by a strategy.
 */
export type SearchResult = {
  /** Entity type identifier, e.g., 'customers:customer_person_profile' */
  entityId: EntityId
  /** Record primary key */
  recordId: string
  /** Relevance score (normalized 0-1 range preferred, but RRF scores may exceed 1) */
  score: number
  /** Which strategy produced this result */
  source: SearchStrategyId
  /** Optional presenter for quick display */
  presenter?: SearchResultPresenter
  /** Primary URL when result is clicked */
  url?: string
  /** Additional action links */
  links?: SearchResultLink[]
  /** Extra metadata from the strategy */
  metadata?: Record<string, unknown>
}

// =============================================================================
// Search Options
// =============================================================================

/**
 * Options passed to SearchService.search()
 */
export type SearchOptions = {
  /** Tenant isolation - required */
  tenantId: string
  /** Optional organization filter */
  organizationId?: string | null
  /** Filter to specific entity types */
  entityTypes?: EntityId[]
  /** Use only specific strategies (defaults to all available) */
  strategies?: SearchStrategyId[]
  /** Maximum results per strategy before merging */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** How to combine results: 'or' merges all, 'and' requires match in all strategies */
  combineMode?: 'or' | 'and'
}

// =============================================================================
// Indexable Record
// =============================================================================

/**
 * A record prepared for indexing across all strategies.
 */
export type IndexableRecord = {
  /** Entity type identifier */
  entityId: EntityId
  /** Record primary key */
  recordId: string
  /** Tenant for isolation */
  tenantId: string
  /** Optional organization for additional filtering */
  organizationId?: string | null
  /** All fields from the record (strategies will filter based on their needs) */
  fields: Record<string, unknown>
  /** Optional presenter for result display */
  presenter?: SearchResultPresenter
  /** Primary URL for the record */
  url?: string
  /** Additional action links */
  links?: SearchResultLink[]
  /** Text content for embedding (from buildSource, used by vector strategy) */
  text?: string | string[]
  /** Source object for checksum calculation (change detection) */
  checksumSource?: unknown
}

// =============================================================================
// Strategy Interface
// =============================================================================

/**
 * Interface that all search strategies must implement.
 * Following the cache module's strategy pattern.
 */
export interface SearchStrategy {
  /** Unique strategy identifier */
  readonly id: SearchStrategyId

  /** Human-readable name for debugging/logging */
  readonly name: string

  /** Priority for result merging (higher = more prominent in results) */
  readonly priority: number

  /** Check if strategy is available and configured */
  isAvailable(): Promise<boolean>

  /** Initialize strategy resources (lazy, called on first use) */
  ensureReady(): Promise<void>

  /** Execute a search query */
  search(query: string, options: SearchOptions): Promise<SearchResult[]>

  /** Index a record */
  index(record: IndexableRecord): Promise<void>

  /** Delete a record from the index */
  delete(entityId: EntityId, recordId: string, tenantId: string): Promise<void>

  /** Bulk index multiple records (optional optimization) */
  bulkIndex?(records: IndexableRecord[]): Promise<void>

  /** Purge all records for an entity type (optional) */
  purge?(entityId: EntityId, tenantId: string): Promise<void>
}

// =============================================================================
// Service Configuration
// =============================================================================

/**
 * Configuration for result merging across strategies.
 */
export type ResultMergeConfig = {
  /** How to handle duplicate results: 'highest_score' | 'first' | 'merge_scores' */
  duplicateHandling: 'highest_score' | 'first' | 'merge_scores'
  /** Weight multipliers per strategy (e.g., { meilisearch: 1.2, tokens: 0.8 }) */
  strategyWeights?: Record<SearchStrategyId, number>
  /** Minimum score threshold to include in results */
  minScore?: number
}

/**
 * Callback function to enrich search results with presenter data.
 * Used to load presenter from database when not available from search strategy.
 */
export type PresenterEnricherFn = (
  results: SearchResult[],
  tenantId: string,
  organizationId?: string | null,
) => Promise<SearchResult[]>

/**
 * Options for creating a SearchService instance.
 */
export type SearchServiceOptions = {
  /** Array of strategy instances */
  strategies?: SearchStrategy[]
  /** Default strategies to use when not specified in search options */
  defaultStrategies?: SearchStrategyId[]
  /** Fallback strategy when others fail */
  fallbackStrategy?: SearchStrategyId
  /** Configuration for merging results from multiple strategies */
  mergeConfig?: ResultMergeConfig
  /** Callback to enrich results with presenter data from database */
  presenterEnricher?: PresenterEnricherFn
}

// =============================================================================
// Module Configuration (for modules defining searchable entities)
// =============================================================================

/**
 * Context passed to buildSource, formatResult, resolveUrl, and resolveLinks.
 */
export type SearchBuildContext = {
  /** The record being indexed */
  record: Record<string, unknown>
  /** Custom fields for the record */
  customFields: Record<string, unknown>
  /** Organization ID if applicable */
  organizationId?: string | null
  /** Tenant ID */
  tenantId?: string | null
  /** DI container for resolving dependencies */
  container?: unknown
  /** Query engine for loading related records (optional, used by buildSource for entity hydration) */
  queryEngine?: unknown
}

/**
 * Source data for indexing a record.
 */
export type SearchIndexSource = {
  /** Text content for keyword/fuzzy search (single string or array of chunks) */
  text: string | string[]
  /** Optional structured fields for filtering */
  fields?: Record<string, unknown>
  /** Presenter for quick display in search results */
  presenter?: SearchResultPresenter
  /** Deep links for the result */
  links?: SearchResultLink[]
  /** Source object used for checksum calculation (change detection) */
  checksumSource?: unknown
}

/**
 * Policy defining how fields should be handled for search indexing.
 */
export type SearchFieldPolicy = {
  /** Fields safe to send to external providers (fuzzy searchable) */
  searchable?: string[]
  /** Fields for hash-based search only (encrypted/sensitive) */
  hashOnly?: string[]
  /** Fields to exclude from all search */
  excluded?: string[]
}

/**
 * Configuration for a single searchable entity within a module.
 */
export type SearchEntityConfig = {
  /** Entity identifier, e.g., 'customers:customer_person_profile' */
  entityId: EntityId
  /** Enable/disable search for this entity (default: true) */
  enabled?: boolean
  /** Override strategies for this specific entity */
  strategies?: SearchStrategyId[]
  /** Priority for result ordering (higher = more prominent) */
  priority?: number
  /** Build searchable content from record */
  buildSource?: (ctx: SearchBuildContext) => Promise<SearchIndexSource | null> | SearchIndexSource | null
  /** Format result for display in Cmd+K */
  formatResult?: (ctx: SearchBuildContext) => Promise<SearchResultPresenter | null> | SearchResultPresenter | null
  /** Resolve primary URL when result is clicked */
  resolveUrl?: (ctx: SearchBuildContext) => Promise<string | null> | string | null
  /** Resolve additional action links */
  resolveLinks?: (ctx: SearchBuildContext) => Promise<SearchResultLink[] | null> | SearchResultLink[] | null
  /** Define which fields are searchable vs hash-only */
  fieldPolicy?: SearchFieldPolicy
}

/**
 * Module-level search configuration (defined in search.ts files).
 */
export type SearchModuleConfig = {
  /** Default strategies for all entities in this module */
  defaultStrategies?: SearchStrategyId[]
  /** Entity configurations */
  entities: SearchEntityConfig[]
}

// =============================================================================
// Event Payloads (for indexer events)
// =============================================================================

/**
 * Payload for search.index_record events.
 */
export type SearchIndexPayload = {
  entityId: EntityId
  recordId: string
  tenantId: string
  organizationId?: string | null
  record: Record<string, unknown>
  customFields?: Record<string, unknown>
}

/**
 * Payload for search.delete_record events.
 */
export type SearchDeletePayload = {
  entityId: EntityId
  recordId: string
  tenantId: string
}

// =============================================================================
// Global Registry for Search Module Configs
// =============================================================================

let _searchModuleConfigs: SearchModuleConfig[] | null = null

/**
 * Register search module configurations globally.
 * Called during app bootstrap with configs from search.generated.ts.
 */
export function registerSearchModuleConfigs(configs: SearchModuleConfig[]): void {
  if (_searchModuleConfigs !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Search module configs re-registered (this may occur during HMR)')
  }
  _searchModuleConfigs = configs
}

/**
 * Get registered search module configurations.
 * Returns empty array if not registered (search module may not be enabled).
 */
export function getSearchModuleConfigs(): SearchModuleConfig[] {
  return _searchModuleConfigs ?? []
}
