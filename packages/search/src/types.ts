/**
 * Re-export all search types from shared package.
 * This allows consumers to import from '@open-mercato/search/types' directly.
 */
export type {
  // Strategy identifiers
  SearchStrategyId,

  // Result types
  SearchResult,
  SearchResultPresenter,
  SearchResultLink,

  // Search options
  SearchOptions,

  // Indexable record
  IndexableRecord,

  // Strategy interface
  SearchStrategy,

  // Service configuration
  ResultMergeConfig,
  SearchServiceOptions,
  PresenterEnricherFn,

  // Module configuration
  SearchBuildContext,
  SearchIndexSource,
  SearchFieldPolicy,
  SearchEntityConfig,
  SearchModuleConfig,

  // Event payloads
  SearchIndexPayload,
  SearchDeletePayload,
} from '@open-mercato/shared/modules/search'
