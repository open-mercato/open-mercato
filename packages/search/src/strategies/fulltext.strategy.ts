import type {
  SearchStrategy,
  SearchStrategyId,
  SearchOptions,
  SearchResult,
  IndexableRecord,
} from '../types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type {
  FullTextSearchDriver,
  FullTextSearchDocument,
  FullTextSearchHit,
  DocumentLookupKey,
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
    const hits = await this.driver.search(query, {
      tenantId: options.tenantId,
      organizationId: options.organizationId,
      entityTypes: options.entityTypes,
      limit: options.limit,
      offset: options.offset,
    })

    return hits.map((hit) => this.mapHitToResult(hit))
  }

  async index(record: IndexableRecord): Promise<void> {
    const doc = this.mapRecordToDocument(record)
    return this.driver.index(doc)
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

  async purge(entityId: EntityId, tenantId: string): Promise<void> {
    if (!this.driver.purge) {
      return
    }
    return this.driver.purge(entityId, tenantId)
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

  get driverId(): string {
    return this.driver.id
  }

  private mapHitToResult(hit: FullTextSearchHit): SearchResult {
    return {
      entityId: hit.entityId,
      recordId: hit.recordId,
      score: hit.score,
      source: this.id,
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
      fields: record.fields,
      presenter: record.presenter,
      url: record.url,
      links: record.links,
    }
  }
}
