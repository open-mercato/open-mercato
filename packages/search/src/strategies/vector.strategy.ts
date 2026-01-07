import type {
  SearchStrategy,
  SearchStrategyId,
  SearchOptions,
  SearchResult,
  IndexableRecord,
} from '../types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { VectorDriver, VectorDriverDocument } from '@open-mercato/vector/types'

/**
 * Embedding service interface - minimal subset needed by VectorSearchStrategy.
 */
export interface EmbeddingService {
  createEmbedding(text: string): Promise<number[]>
  available: boolean
}

/**
 * Configuration for VectorSearchStrategy.
 */
export type VectorStrategyConfig = {
  /** Default limit for search results */
  defaultLimit?: number
}

/**
 * VectorSearchStrategy provides semantic search using embeddings.
 * It wraps the existing vector module infrastructure.
 */
export class VectorSearchStrategy implements SearchStrategy {
  readonly id: SearchStrategyId = 'vector'
  readonly name = 'Vector Search'
  readonly priority = 20 // Medium priority

  private readonly defaultLimit: number
  private ready = false

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorDriver: VectorDriver,
    config?: VectorStrategyConfig,
  ) {
    this.defaultLimit = config?.defaultLimit ?? 20
  }

  async isAvailable(): Promise<boolean> {
    return this.embeddingService.available
  }

  async ensureReady(): Promise<void> {
    if (this.ready) return
    await this.vectorDriver.ensureReady()
    this.ready = true
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const embedding = await this.embeddingService.createEmbedding(query)

    // Build filter - only include organizationId if it's a real value
    // The pgvector driver treats null as "only records with null org_id",
    // but we want null/undefined to mean "no organization filter"
    const filter: {
      tenantId: string
      organizationId?: string | null
      entityIds?: EntityId[]
    } = {
      tenantId: options.tenantId,
      entityIds: options.entityTypes as EntityId[],
    }

    // Only add organizationId filter if it's a real org ID
    if (options.organizationId) {
      filter.organizationId = options.organizationId
    }

    const results = await this.vectorDriver.query({
      vector: embedding,
      limit: options.limit ?? this.defaultLimit,
      filter,
    })

    return results.map((hit) => ({
      entityId: hit.entityId,
      recordId: hit.recordId,
      score: hit.score,
      source: this.id,
      presenter: hit.presenter ?? undefined,
      url: hit.primaryLinkHref ?? hit.url ?? undefined,
      links: hit.links?.map((link) => ({
        href: link.href,
        label: link.label ?? '',
        kind: link.kind,
      })),
      metadata: hit.payload ?? undefined,
    }))
  }

  async index(record: IndexableRecord): Promise<void> {
    // Build text content for embedding
    const textContent = this.buildTextContent(record)
    if (!textContent) return

    const embedding = await this.embeddingService.createEmbedding(textContent)

    const doc: VectorDriverDocument = {
      entityId: record.entityId as EntityId,
      recordId: record.recordId,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      checksum: this.computeSimpleChecksum(record),
      embedding,
      url: record.url,
      presenter: record.presenter,
      links: record.links,
      driverId: this.vectorDriver.id,
      resultTitle: record.presenter?.title ?? record.recordId,
      resultSubtitle: record.presenter?.subtitle,
      resultIcon: record.presenter?.icon,
      resultBadge: record.presenter?.badge,
    }

    await this.vectorDriver.upsert(doc)
  }

  async delete(entityId: EntityId, recordId: string, tenantId: string): Promise<void> {
    await this.vectorDriver.delete(entityId, recordId, tenantId)
  }

  async purge(entityId: EntityId, tenantId: string): Promise<void> {
    if (this.vectorDriver.purge) {
      await this.vectorDriver.purge(entityId, tenantId)
    }
  }

  /**
   * Build text content from record fields for embedding.
   */
  private buildTextContent(record: IndexableRecord): string {
    const parts: string[] = []

    // Add presenter info
    if (record.presenter?.title) {
      parts.push(record.presenter.title)
    }
    if (record.presenter?.subtitle) {
      parts.push(record.presenter.subtitle)
    }

    // Add string fields from record
    for (const [, value] of Object.entries(record.fields)) {
      if (typeof value === 'string' && value.trim()) {
        parts.push(value)
      }
    }

    return parts.join(' ').trim()
  }

  /**
   * Compute a simple checksum for change detection.
   */
  private computeSimpleChecksum(record: IndexableRecord): string {
    const content = JSON.stringify({
      fields: record.fields,
      presenter: record.presenter,
      url: record.url,
    })
    // Simple hash - in production, use crypto
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16)
  }
}
