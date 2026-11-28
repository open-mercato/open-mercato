export type {
  FullTextSearchDriverId,
  FullTextSearchDocument,
  FullTextSearchQuery,
  FullTextSearchHit,
  DocumentLookupKey,
  ListDocumentIdsOptions,
  IndexStats,
  FullTextSearchDriverConfig,
  FullTextSearchDriver,
} from './types'

export { createMeilisearchDriver, type MeilisearchDriverOptions } from './drivers/meilisearch'
export {
  FULLTEXT_DRIVER_ENV,
  UNAVAILABLE_FULLTEXT_DRIVER_ID,
  createFulltextDriver,
  createUnavailableFulltextDriver,
  getFulltextDriverFactory,
  listFulltextDriverFactories,
  meilisearchDriverFactory,
  registerFulltextDriverFactory,
  resolveFulltextDriverId,
  resolveFulltextDriverSelection,
  type FulltextDriverDescriptor,
  type FulltextDriverEnvVar,
  type FulltextDriverFactory,
  type FulltextDriverFactoryOptions,
  type FulltextDriverSelection,
  type FulltextDriverSelectionReason,
  type FulltextDriverSelectionSource,
} from './drivers'
