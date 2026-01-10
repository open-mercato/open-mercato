import { MeiliSearch } from 'meilisearch'
import type {
  SearchStrategy,
  SearchStrategyId,
  SearchOptions,
  SearchResult,
  IndexableRecord,
  SearchFieldPolicy,
} from '../types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { extractSearchableFields, type EncryptionMapEntry } from '../lib/field-policy'

/**
 * Configuration for MeilisearchStrategy.
 */
export type MeilisearchStrategyConfig = {
  /** Meilisearch host URL */
  host?: string
  /** Meilisearch API key */
  apiKey?: string
  /** Prefix for index names (default: 'om') */
  indexPrefix?: string
  /** Default limit for search results */
  defaultLimit?: number
  /** Resolver for encryption maps per entity */
  encryptionMapResolver?: (entityId: EntityId) => Promise<EncryptionMapEntry[]>
  /** Resolver for field policies per entity */
  fieldPolicyResolver?: (entityId: EntityId) => SearchFieldPolicy | undefined
}

/**
 * MeilisearchStrategy provides full-text fuzzy search using Meilisearch.
 * It handles tenant isolation through separate indexes per tenant.
 */
export class MeilisearchStrategy implements SearchStrategy {
  readonly id: SearchStrategyId = 'meilisearch'
  readonly name = 'Meilisearch'
  readonly priority = 30 // Highest priority when available

  private client: MeiliSearch | null = null
  private readonly host: string
  private readonly apiKey: string
  private readonly indexPrefix: string
  private readonly defaultLimit: number
  private readonly encryptionMapResolver?: (entityId: EntityId) => Promise<EncryptionMapEntry[]>
  private readonly fieldPolicyResolver?: (entityId: EntityId) => SearchFieldPolicy | undefined
  private readonly initializedIndexes = new Set<string>()
  private readonly initializingIndexes = new Map<string, Promise<void>>()

  constructor(config?: MeilisearchStrategyConfig) {
    this.host = config?.host ?? process.env.MEILISEARCH_HOST ?? ''
    this.apiKey = config?.apiKey ?? process.env.MEILISEARCH_API_KEY ?? ''
    this.indexPrefix = config?.indexPrefix ?? process.env.MEILISEARCH_INDEX_PREFIX ?? 'om'
    this.defaultLimit = config?.defaultLimit ?? 20
    this.encryptionMapResolver = config?.encryptionMapResolver
    this.fieldPolicyResolver = config?.fieldPolicyResolver
  }

  async isAvailable(): Promise<boolean> {
    if (!this.host) return false

    try {
      const client = this.getClient()
      await client.health()
      return true
    } catch {
      return false
    }
  }

  async ensureReady(): Promise<void> {
    // Client is lazily initialized
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const client = this.getClient()
    const indexName = this.buildIndexName(options.tenantId)

    try {
      const index = client.index(indexName)
      const filters = this.buildFilters(options)

      const response = await index.search(query, {
        limit: options.limit ?? this.defaultLimit,
        offset: options.offset,
        filter: filters.length > 0 ? filters.join(' AND ') : undefined,
        showRankingScore: true,
      })

      return response.hits.map((hit: Record<string, unknown>) => ({
        entityId: hit._entityId as EntityId,
        recordId: hit._id as string,
        score: (hit._rankingScore as number) ?? 0.5,
        source: this.id,
        presenter: hit._presenter as SearchResult['presenter'],
        url: hit._url as string | undefined,
        links: hit._links as SearchResult['links'],
        metadata: hit._metadata as Record<string, unknown> | undefined,
      }))
    } catch (error: unknown) {
      const meilisearchError = error as { code?: string }
      if (meilisearchError.code === 'index_not_found') {
        return []
      }
      throw error
    }
  }

  async index(record: IndexableRecord): Promise<void> {
    const client = this.getClient()
    const indexName = this.buildIndexName(record.tenantId)

    await this.ensureIndex(indexName)

    // Get encryption map and field policy for this entity
    const encryptedFields = this.encryptionMapResolver
      ? await this.encryptionMapResolver(record.entityId as EntityId)
      : []
    const fieldPolicy = this.fieldPolicyResolver?.(record.entityId as EntityId)

    // Extract only searchable fields
    const searchableFields = extractSearchableFields(record.fields, {
      encryptedFields,
      fieldPolicy,
    })

    const document = {
      _id: record.recordId,
      _entityId: record.entityId,
      _organizationId: record.organizationId,
      _presenter: record.presenter,
      _url: record.url,
      _links: record.links,
      _indexedAt: new Date().toISOString(),
      ...searchableFields,
    }

    const index = client.index(indexName)
    await index.addDocuments([document], { primaryKey: '_id' })
  }

  async delete(entityId: EntityId, recordId: string, tenantId: string): Promise<void> {
    const client = this.getClient()
    const indexName = this.buildIndexName(tenantId)

    try {
      const index = client.index(indexName)
      await index.deleteDocument(recordId)
    } catch (error: unknown) {
      const meilisearchError = error as { code?: string }
      if (meilisearchError.code === 'index_not_found') {
        return // Index doesn't exist, nothing to delete
      }
      throw error
    }
  }

  async bulkIndex(records: IndexableRecord[]): Promise<void> {
    if (records.length === 0) return

    // Group records by tenant
    const byTenant = new Map<string, IndexableRecord[]>()
    for (const record of records) {
      const list = byTenant.get(record.tenantId) ?? []
      list.push(record)
      byTenant.set(record.tenantId, list)
    }

    const client = this.getClient()

    for (const [tenantId, tenantRecords] of byTenant) {
      const indexName = this.buildIndexName(tenantId)
      await this.ensureIndex(indexName)

      const documents = await Promise.all(
        tenantRecords.map(async (record) => {
          const encryptedFields = this.encryptionMapResolver
            ? await this.encryptionMapResolver(record.entityId as EntityId)
            : []
          const fieldPolicy = this.fieldPolicyResolver?.(record.entityId as EntityId)

          const searchableFields = extractSearchableFields(record.fields, {
            encryptedFields,
            fieldPolicy,
          })

          return {
            _id: record.recordId,
            _entityId: record.entityId,
            _organizationId: record.organizationId,
            _presenter: record.presenter,
            _url: record.url,
            _links: record.links,
            _indexedAt: new Date().toISOString(),
            ...searchableFields,
          }
        }),
      )

      const index = client.index(indexName)
      await index.addDocuments(documents, { primaryKey: '_id' })
    }
  }

  async purge(entityId: EntityId, tenantId: string): Promise<void> {
    const client = this.getClient()
    const indexName = this.buildIndexName(tenantId)

    try {
      const index = client.index(indexName)
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
  }

  /**
   * Delete all documents from the index for a tenant (keeps index structure).
   */
  async clearIndex(tenantId: string): Promise<void> {
    const client = this.getClient()
    const indexName = this.buildIndexName(tenantId)

    try {
      const index = client.index(indexName)
      await index.deleteAllDocuments()
    } catch (error: unknown) {
      const meilisearchError = error as { code?: string }
      if (meilisearchError.code === 'index_not_found') {
        return
      }
      throw error
    }
  }

  /**
   * Delete and recreate the index for a tenant.
   */
  async recreateIndex(tenantId: string): Promise<void> {
    const client = this.getClient()
    const indexName = this.buildIndexName(tenantId)

    // Remove from initialized set so it gets recreated
    this.initializedIndexes.delete(indexName)

    try {
      await client.deleteIndex(indexName)
    } catch (error: unknown) {
      const meilisearchError = error as { code?: string }
      if (meilisearchError.code !== 'index_not_found') {
        throw error
      }
    }

    // Recreate with proper settings
    await this.ensureIndex(indexName)
  }

  /**
   * Get documents by their IDs for presenter data enrichment.
   * Used by SearchService to enrich token-only results with presenter data.
   *
   * @param ids - Array of entity/record ID pairs to look up
   * @param tenantId - Tenant for index lookup
   * @returns Map of "entityId:recordId" to SearchResult with presenter data
   */
  async getDocuments(
    ids: Array<{ entityId: string; recordId: string }>,
    tenantId: string,
  ): Promise<Map<string, SearchResult>> {
    const result = new Map<string, SearchResult>()
    if (ids.length === 0) return result

    const client = this.getClient()
    const indexName = this.buildIndexName(tenantId)

    try {
      const index = client.index(indexName)

      // Meilisearch supports batch document retrieval
      const recordIds = ids.map((id) => id.recordId)
      const documents = await index.getDocuments({
        filter: `_id IN [${recordIds.map((id) => `"${id}"`).join(', ')}]`,
        limit: recordIds.length,
      })

      for (const doc of documents.results) {
        const hit = doc as Record<string, unknown>
        const key = `${hit._entityId}:${hit._id}`
        result.set(key, {
          entityId: hit._entityId as EntityId,
          recordId: hit._id as string,
          score: 0,
          source: this.id,
          presenter: hit._presenter as SearchResult['presenter'],
          url: hit._url as string | undefined,
          links: hit._links as SearchResult['links'],
        })
      }
    } catch {
      // Index not found or error, return empty map
    }

    return result
  }

  /**
   * Get stats for the tenant's index.
   */
  async getIndexStats(tenantId: string): Promise<{
    numberOfDocuments: number
    isIndexing: boolean
    fieldDistribution: Record<string, number>
  } | null> {
    const client = this.getClient()
    const indexName = this.buildIndexName(tenantId)

    try {
      const index = client.index(indexName)
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
  }

  /**
   * Get document counts per entity type for the tenant's index.
   */
  async getEntityCounts(tenantId: string): Promise<Record<string, number> | null> {
    const client = this.getClient()
    const indexName = this.buildIndexName(tenantId)

    try {
      const index = client.index(indexName)
      // Use search with facets to get counts per entity type
      const result = await index.search('', {
        limit: 0,
        facets: ['_entityId'],
      })
      const facetDistribution = result.facetDistribution?._entityId
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
  }

  /**
   * Get or create the Meilisearch client.
   */
  private getClient(): MeiliSearch {
    if (!this.client) {
      this.client = new MeiliSearch({
        host: this.host,
        apiKey: this.apiKey,
      })
    }
    return this.client
  }

  /**
   * Build tenant-isolated index name.
   */
  private buildIndexName(tenantId: string): string {
    const sanitized = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return `${this.indexPrefix}_${sanitized}`
  }

  /**
   * Escape special characters in filter values to prevent injection.
   */
  private escapeFilterValue(value: string): string {
    return value.replace(/["\\]/g, '\\$&')
  }

  /**
   * Build filter string from search options.
   */
  private buildFilters(options: SearchOptions): string[] {
    const filters: string[] = []

    if (options.organizationId) {
      filters.push(`_organizationId = "${this.escapeFilterValue(options.organizationId)}"`)
    }

    if (options.entityTypes?.length) {
      const entityFilter = options.entityTypes.map((t) => `"${this.escapeFilterValue(t)}"`).join(', ')
      filters.push(`_entityId IN [${entityFilter}]`)
    }

    return filters
  }

  /**
   * Ensure index exists with proper settings.
   * Uses promise-based locking to prevent race conditions.
   */
  private async ensureIndex(indexName: string): Promise<void> {
    if (this.initializedIndexes.has(indexName)) return

    // Check if initialization is already in progress
    const existingPromise = this.initializingIndexes.get(indexName)
    if (existingPromise) {
      return existingPromise
    }

    // Start initialization and store the promise
    const initPromise = this.doEnsureIndex(indexName)
    this.initializingIndexes.set(indexName, initPromise)

    try {
      await initPromise
    } finally {
      this.initializingIndexes.delete(indexName)
    }
  }

  /**
   * Actually create and configure the index.
   */
  private async doEnsureIndex(indexName: string): Promise<void> {
    const client = this.getClient()

    try {
      await client.createIndex(indexName, { primaryKey: '_id' })
    } catch (error: unknown) {
      const meilisearchError = error as { code?: string }
      if (meilisearchError.code !== 'index_already_exists') {
        throw error
      }
    }

    const index = client.index(indexName)
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

    this.initializedIndexes.add(indexName)
  }
}
