import type { FullTextSearchDriver, FullTextSearchDriverConfig } from '../types'
import { createMeilisearchDriver } from './meilisearch'

export { createMeilisearchDriver, type MeilisearchDriverOptions } from './meilisearch'

export type FulltextDriverFactoryOptions = FullTextSearchDriverConfig & {
  meilisearch?: {
    host?: string
    apiKey?: string
    indexPrefix?: string
  }
  algolia?: {
    appId?: string
    apiKey?: string
    indexPrefix?: string
  }
}

export function createFulltextDriver(
  options?: FulltextDriverFactoryOptions
): FullTextSearchDriver | null {
  const meilisearchHost = options?.meilisearch?.host ?? process.env.MEILISEARCH_HOST

  if (meilisearchHost) {
    return createMeilisearchDriver({
      host: meilisearchHost,
      apiKey: options?.meilisearch?.apiKey ?? process.env.MEILISEARCH_API_KEY,
      indexPrefix: options?.meilisearch?.indexPrefix ?? process.env.MEILISEARCH_INDEX_PREFIX,
      encryptionMapResolver: options?.encryptionMapResolver,
      fieldPolicyResolver: options?.fieldPolicyResolver,
      defaultLimit: options?.defaultLimit,
    })
  }

  // Future: Add Algolia, Elasticsearch, Typesense drivers here
  // if (options?.algolia?.appId || process.env.ALGOLIA_APP_ID) {
  //   return createAlgoliaDriver({ ... })
  // }

  return null
}
