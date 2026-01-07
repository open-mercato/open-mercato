export { SearchIndexer } from './search-indexer'
export type { IndexRecordParams, DeleteRecordParams, PurgeEntityParams } from './search-indexer'

export { createSearchIndexSubscriber, metadata as searchIndexMetadata } from './subscribers/upsert'
export { createSearchDeleteSubscriber, metadata as searchDeleteMetadata } from './subscribers/delete'
