import type {
  SearchStrategy,
  SearchStrategyId,
  SearchOptions,
  SearchResult,
  IndexableRecord,
} from '../types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { plaintextSearchFields } from '../lib/plaintext-fields'
import type {
  FullTextSearchDriver,
  FullTextSearchDocument,
  FullTextSearchHit,
  DocumentLookupKey,
  ListDocumentIdsOptions,
  IndexStats,
} from '../fulltext/types'

/**
 * FullTextSearchStrategy provides full-text fuzzy search using a pluggable driver.
 * Default driver is Meilisearch, but can be swapped for Algolia, Elasticsearch, etc.
 */
export class FullTextSearchStrategy implements SearchStrategy {
  readonly id: SearchStrategyId = 'fulltext'
  readonly name = 'Full-Text Search'
  readonly priority = 30 // Highest priority when available

  constructor(private readonly driver: FullTextSearchDriver) {}

  async isAvailable(): Promise<boolean> {
    return this.driver.isHealthy()
  }

  async ensureReady(): Promise<void> {
    return this.driver.ensureReady()
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    if (options.indexDocFilter) return []
    if (Array.isArray(options.organizationIds)) {
      const organizationIds = options.organizationIds
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0)
      if (!options.organizationId && organizationIds.length === 0) return []
    }

    const hits = await this.driver.search(query, {
      tenantId: options.tenantId,
      organizationId: options.organizationId,
      organizationIds: options.organizationIds,
      entityTypes: options.entityTypes,
      limit: options.limit,
      offset: options.offset,
    })

    return hits.map((hit) => this.mapHitToResult(hit))
  }

  async index(record: IndexableRecord): Promise<void> {
    const doc = this.mapRecordToDocument(record)
    await this.driver.index(doc)
  }

  async delete(entityId: EntityId, recordId: string, tenantId: string): Promise<void> {
    return this.driver.delete(recordId, tenantId)
  }

  async bulkIndex(records: IndexableRecord[]): Promise<void> {
    if (!this.driver.bulkIndex) {
      // Fallback to sequential indexing
      for (const record of records) {
        await this.index(record)
      }
      return
    }

    const docs = records.map((record) => this.mapRecordToDocument(record))
    return this.driver.bulkIndex(docs)
  }

  /**
   * Whether one entity's documents (optionally one organization's) can be removed without
   * touching the rest of the tenant index: natively through `driver.purge`, or by enumerating
   * them with `driver.listDocumentIds` and deleting them one by one.
   */
  canPurge(): boolean {
    return typeof this.driver.purge === 'function' || typeof this.driver.listDocumentIds === 'function'
  }

  async purge(entityId: EntityId, tenantId: string, organizationId?: string | null): Promise<void> {
    if (this.driver.purge) {
      return this.driver.purge(entityId, tenantId, organizationId)
    }
    if (!this.driver.listDocumentIds) {
      return
    }
    const recordIds = await this.listAllDocumentIds(entityId, tenantId, organizationId ?? null)
    for (const recordId of recordIds) {
      await this.driver.delete(recordId, tenantId)
    }
  }

  private async listAllDocumentIds(
    entityId: EntityId,
    tenantId: string,
    organizationId: string | null,
  ): Promise<string[]> {
    const listDocumentIds = this.driver.listDocumentIds
    if (!listDocumentIds) return []
    const pageSize = 1000
    const recordIds = new Set<string>()
    for (let offset = 0; ; offset += pageSize) {
      const page = await listDocumentIds.call(this.driver, entityId, tenantId, {
        offset,
        limit: pageSize,
        organizationId,
      })
      const knownCount = recordIds.size
      for (const recordId of page) recordIds.add(recordId)
      if (page.length < pageSize || recordIds.size === knownCount) break
    }
    return [...recordIds]
  }

  // Additional methods exposed for enrichment and admin purposes
  // These delegate to optional driver methods

  async clearIndex(tenantId: string): Promise<void> {
    if (!this.driver.clearIndex) {
      return
    }
    return this.driver.clearIndex(tenantId)
  }

  async recreateIndex(tenantId: string): Promise<void> {
    if (!this.driver.recreateIndex) {
      return
    }
    return this.driver.recreateIndex(tenantId)
  }

  async getDocuments(
    ids: DocumentLookupKey[],
    tenantId: string
  ): Promise<Map<string, SearchResult>> {
    if (!this.driver.getDocuments) {
      return new Map()
    }

    const hits = await this.driver.getDocuments(ids, tenantId)
    const result = new Map<string, SearchResult>()

    for (const [key, hit] of hits) {
      result.set(key, this.mapHitToResult(hit))
    }

    return result
  }

  async getIndexStats(tenantId: string): Promise<IndexStats | null> {
    if (!this.driver.getIndexStats) {
      return null
    }
    return this.driver.getIndexStats(tenantId)
  }

  async getEntityCounts(tenantId: string): Promise<Record<string, number> | null> {
    if (!this.driver.getEntityCounts) {
      return null
    }
    return this.driver.getEntityCounts(tenantId)
  }

  async listDocumentIds(
    entityId: EntityId,
    tenantId: string,
    options?: ListDocumentIdsOptions
  ): Promise<string[] | null> {
    if (!this.driver.listDocumentIds) {
      return null
    }
    return this.driver.listDocumentIds(entityId, tenantId, options)
  }

  get driverId(): string {
    return this.driver.id
  }

  private mapHitToResult(hit: FullTextSearchHit): SearchResult {
    return {
      entityId: hit.entityId,
      recordId: hit.recordId,
      score: hit.score,
      source: this.id,
      organizationId: hit.organizationId ?? null,
      presenter: hit.presenter,
      url: hit.url,
      links: hit.links,
      metadata: hit.metadata,
    }
  }

  private mapRecordToDocument(record: IndexableRecord): FullTextSearchDocument {
    return {
      recordId: record.recordId,
      entityId: record.entityId,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      fields: plaintextSearchFields(record),
      presenter: record.presenter,
      url: record.url,
      links: record.links,
    }
  }
}
