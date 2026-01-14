import { MeiliSearch } from 'meilisearch'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { SearchFieldPolicy } from '@open-mercato/shared/modules/search'
import type {
  FullTextSearchDriver,
  FullTextSearchDocument,
  FullTextSearchQuery,
  FullTextSearchHit,
  DocumentLookupKey,
  IndexStats,
} from '../../types'
import { extractSearchableFields, type EncryptionMapEntry } from '../../../lib/field-policy'


export type MeilisearchDriverOptions = {
  host?: string
  apiKey?: string
  indexPrefix?: string
  defaultLimit?: number
  encryptionMapResolver?: (entityId: EntityId) => Promise<EncryptionMapEntry[]>
  fieldPolicyResolver?: (entityId: EntityId) => SearchFieldPolicy | undefined
}

export function createMeilisearchDriver(
  options?: MeilisearchDriverOptions
): FullTextSearchDriver {
  const host = options?.host ?? process.env.MEILISEARCH_HOST ?? ''
  const apiKey = options?.apiKey ?? process.env.MEILISEARCH_API_KEY ?? ''
  const indexPrefix = options?.indexPrefix ?? process.env.MEILISEARCH_INDEX_PREFIX ?? 'om'
  const defaultLimit = options?.defaultLimit ?? 20
  const encryptionMapResolver = options?.encryptionMapResolver
  const fieldPolicyResolver = options?.fieldPolicyResolver

  let client: MeiliSearch | null = null
  const initializedIndexes = new Set<string>()
  const initializingIndexes = new Map<string, Promise<void>>()

  function getClient(): MeiliSearch {
    if (!client) {
      client = new MeiliSearch({ host, apiKey })
    }
    return client
  }

  function buildIndexName(tenantId: string): string {
    const sanitized = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return `${indexPrefix}_${sanitized}`
  }

  function escapeFilterValue(value: string): string {
    return value.replace(/["\\]/g, '\\$&')
  }

  function buildFilters(options: FullTextSearchQuery): string[] {
    const filters: string[] = []

    if (options.organizationId) {
      filters.push(`_organizationId = "${escapeFilterValue(options.organizationId)}"`)
    }

    if (options.entityTypes?.length) {
      const entityFilter = options.entityTypes.map((t) => `"${escapeFilterValue(t)}"`).join(', ')
      filters.push(`_entityId IN [${entityFilter}]`)
    }

    return filters
  }

  async function doEnsureIndex(indexName: string): Promise<void> {
    const meiliClient = getClient()

    try {
      await meiliClient.createIndex(indexName, { primaryKey: '_id' })
    } catch (error: unknown) {
      const meilisearchError = error as { code?: string }
      if (meilisearchError.code !== 'index_already_exists') {
        throw error
      }
    }

    const index = meiliClient.index(indexName)
    await index.updateSettings({
      searchableAttributes: ['*'],
      filterableAttributes: ['_entityId', '_organizationId'],
      sortableAttributes: ['_indexedAt'],
      typoTolerance: {
        enabled: true,
        minWordSizeForTypos: {
          oneTypo: 4,
          twoTypos: 8,
        },
      },
    })

    initializedIndexes.add(indexName)
  }

  async function ensureIndex(indexName: string): Promise<void> {
    if (initializedIndexes.has(indexName)) return

    const existingPromise = initializingIndexes.get(indexName)
    if (existingPromise) {
      return existingPromise
    }

    const initPromise = doEnsureIndex(indexName)
    initializingIndexes.set(indexName, initPromise)

    try {
      await initPromise
    } finally {
      initializingIndexes.delete(indexName)
    }
  }

  async function prepareDocument(doc: FullTextSearchDocument): Promise<Record<string, unknown>> {
    // When encryptionMapResolver is provided, SEARCH_EXCLUDE_ENCRYPTED_FIELDS is enabled
    const excludeEncrypted = Boolean(encryptionMapResolver)
    const encryptedFields = encryptionMapResolver
      ? await encryptionMapResolver(doc.entityId)
      : []
    const fieldPolicy = fieldPolicyResolver?.(doc.entityId)

    const searchableFields = extractSearchableFields(doc.fields, {
      encryptedFields,
      fieldPolicy,
    })

    // When SEARCH_EXCLUDE_ENCRYPTED_FIELDS is enabled:
    // - Exclude sensitive parts of presenter (title, subtitle) - these are derived from encrypted fields
    // - Keep non-sensitive parts (icon, badge)
    // - Sanitize link labels (they often contain names derived from encrypted fields)
    // - Title/subtitle/link labels will be enriched at search time from the database
    let presenter = doc.presenter
    let links = doc.links
    if (excludeEncrypted) {
      if (presenter) {
        presenter = {
          ...presenter,
          title: '', // Will be enriched at search time
          subtitle: undefined, // Will be enriched at search time
        }
      }
      // Sanitize link labels - they often contain sensitive data (names, etc.)
      if (links && links.length > 0) {
        links = links.map((link) => ({
          ...link,
          label: link.kind === 'primary' ? 'Open' : 'View', // Generic labels
        }))
      }
    }

    return {
      _id: doc.recordId,
      _entityId: doc.entityId,
      _organizationId: doc.organizationId,
      _presenter: presenter,
      _url: doc.url,
      _links: links,
      _indexedAt: new Date().toISOString(),
      ...searchableFields,
    }
  }

  const driver: FullTextSearchDriver = {
    id: 'meilisearch',

    async ensureReady(): Promise<void> {
      // Client is lazily initialized
    },

    async isHealthy(): Promise<boolean> {
      if (!host) return false

      try {
        const meiliClient = getClient()
        await meiliClient.health()
        return true
      } catch {
        return false
      }
    },

    async search(query: string, options: FullTextSearchQuery): Promise<FullTextSearchHit[]> {
      const meiliClient = getClient()
      const indexName = buildIndexName(options.tenantId)

      try {
        const index = meiliClient.index(indexName)
        const filters = buildFilters(options)

        const response = await index.search(query, {
          limit: options.limit ?? defaultLimit,
          offset: options.offset,
          filter: filters.length > 0 ? filters.join(' AND ') : undefined,
          showRankingScore: true,
        })

        return response.hits.map((hit: Record<string, unknown>) => ({
          recordId: hit._id as string,
          entityId: hit._entityId as EntityId,
          score: (hit._rankingScore as number) ?? 0.5,
          presenter: hit._presenter as FullTextSearchHit['presenter'],
          url: hit._url as string | undefined,
          links: hit._links as FullTextSearchHit['links'],
          metadata: hit._metadata as Record<string, unknown> | undefined,
        }))
      } catch (error: unknown) {
        const meilisearchError = error as { code?: string }
        if (meilisearchError.code === 'index_not_found') {
          return []
        }
        throw error
      }
    },

    async index(doc: FullTextSearchDocument): Promise<void> {
      const meiliClient = getClient()
      const indexName = buildIndexName(doc.tenantId)

      await ensureIndex(indexName)

      const document = await prepareDocument(doc)
      const index = meiliClient.index(indexName)
      await index.addDocuments([document], { primaryKey: '_id' })
    },

    async delete(recordId: string, tenantId: string): Promise<void> {
      const meiliClient = getClient()
      const indexName = buildIndexName(tenantId)

      try {
        const index = meiliClient.index(indexName)
        await index.deleteDocument(recordId)
      } catch (error: unknown) {
        const meilisearchError = error as { code?: string }
        if (meilisearchError.code === 'index_not_found') {
          return
        }
        throw error
      }
    },

    async bulkIndex(docs: FullTextSearchDocument[]): Promise<void> {
      if (docs.length === 0) return

      // Group documents by tenant
      const byTenant = new Map<string, FullTextSearchDocument[]>()
      for (const doc of docs) {
        const list = byTenant.get(doc.tenantId) ?? []
        list.push(doc)
        byTenant.set(doc.tenantId, list)
      }

      const meiliClient = getClient()

      for (const [tenantId, tenantDocs] of byTenant) {
        const indexName = buildIndexName(tenantId)
        await ensureIndex(indexName)

        const documents = await Promise.all(tenantDocs.map(prepareDocument))

        const index = meiliClient.index(indexName)
        await index.addDocuments(documents, { primaryKey: '_id' })
      }
    },

    async purge(entityId: EntityId, tenantId: string): Promise<void> {
      const meiliClient = getClient()
      const indexName = buildIndexName(tenantId)

      try {
        const index = meiliClient.index(indexName)
        await index.deleteDocuments({
          filter: `_entityId = "${entityId}"`,
        })
      } catch (error: unknown) {
        const meilisearchError = error as { code?: string }
        if (meilisearchError.code === 'index_not_found') {
          return
        }
        throw error
      }
    },

    async clearIndex(tenantId: string): Promise<void> {
      const meiliClient = getClient()
      const indexName = buildIndexName(tenantId)

      try {
        const index = meiliClient.index(indexName)
        await index.deleteAllDocuments()
      } catch (error: unknown) {
        const meilisearchError = error as { code?: string }
        if (meilisearchError.code === 'index_not_found') {
          return
        }
        throw error
      }
    },

    async recreateIndex(tenantId: string): Promise<void> {
      const meiliClient = getClient()
      const indexName = buildIndexName(tenantId)

      initializedIndexes.delete(indexName)

      try {
        await meiliClient.deleteIndex(indexName)
      } catch (error: unknown) {
        const meilisearchError = error as { code?: string }
        if (meilisearchError.code !== 'index_not_found') {
          throw error
        }
      }

      await ensureIndex(indexName)
    },

    async getDocuments(
      ids: DocumentLookupKey[],
      tenantId: string
    ): Promise<Map<string, FullTextSearchHit>> {
      const result = new Map<string, FullTextSearchHit>()
      if (ids.length === 0) return result

      const meiliClient = getClient()
      const indexName = buildIndexName(tenantId)

      try {
        const index = meiliClient.index(indexName)

        const recordIds = ids.map((id) => id.recordId)
        const documents = await index.getDocuments({
          filter: `_id IN [${recordIds.map((id) => `"${id}"`).join(', ')}]`,
          limit: recordIds.length,
        })

        for (const doc of documents.results) {
          const hit = doc as Record<string, unknown>
          const key = `${hit._entityId}:${hit._id}`
          result.set(key, {
            recordId: hit._id as string,
            entityId: hit._entityId as EntityId,
            score: 0,
            presenter: hit._presenter as FullTextSearchHit['presenter'],
            url: hit._url as string | undefined,
            links: hit._links as FullTextSearchHit['links'],
          })
        }
      } catch {
        // Index not found or error, return empty map
      }

      return result
    },

    async getIndexStats(tenantId: string): Promise<IndexStats | null> {
      const meiliClient = getClient()
      const indexName = buildIndexName(tenantId)

      try {
        const index = meiliClient.index(indexName)
        const stats = await index.getStats()
        return {
          numberOfDocuments: stats.numberOfDocuments,
          isIndexing: stats.isIndexing,
          fieldDistribution: stats.fieldDistribution,
        }
      } catch (error: unknown) {
        const meilisearchError = error as { code?: string }
        if (meilisearchError.code === 'index_not_found') {
          return null
        }
        throw error
      }
    },

    async getEntityCounts(tenantId: string): Promise<Record<string, number> | null> {
      const meiliClient = getClient()
      const indexName = buildIndexName(tenantId)

      try {
        const index = meiliClient.index(indexName)
        const searchResult = await index.search('', {
          limit: 0,
          facets: ['_entityId'],
        })
        const facetDistribution = searchResult.facetDistribution?._entityId
        if (!facetDistribution) {
          return {}
        }
        return facetDistribution
      } catch (error: unknown) {
        const meilisearchError = error as { code?: string }
        if (meilisearchError.code === 'index_not_found') {
          return null
        }
        throw error
      }
    },
  }

  return driver
}
