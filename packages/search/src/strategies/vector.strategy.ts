import { createHash } from 'crypto'
import type {
  SearchStrategy,
  SearchStrategyId,
  SearchOptions,
  SearchResult,
  IndexableRecord,
} from '../types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { VectorDriver, VectorDriverDocument } from '../vector/types'

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
  private readyPromise: Promise<void> | null = null

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
    if (!this.readyPromise) {
      this.readyPromise = this.vectorDriver.ensureReady().then(() => {
        this.ready = true
      })
    }
    return this.readyPromise
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
    // Use text from buildSource if available, otherwise fall back to generic extraction
    const textContent = record.text
      ? (Array.isArray(record.text) ? record.text.join('\n') : record.text)
      : this.buildTextContent(record)
    if (!textContent) return

    const embedding = await this.embeddingService.createEmbedding(textContent)

    const doc: VectorDriverDocument = {
      entityId: record.entityId as EntityId,
      recordId: record.recordId,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      checksum: this.computeChecksum(record),
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
   * Compute a checksum for change detection using SHA-256.
   * Uses checksumSource from buildSource if available, otherwise uses fields/presenter/url.
   */
  private computeChecksum(record: IndexableRecord): string {
    const source = record.checksumSource !== undefined
      ? record.checksumSource
      : {
          fields: record.fields,
          presenter: record.presenter,
          url: record.url,
        }
    const content = JSON.stringify(source)
    return createHash('sha256').update(content).digest('hex').slice(0, 16)
  }

  /**
   * List entries in the vector index (for admin/debugging).
   */
  async listEntries(options: {
    tenantId: string
    organizationId?: string | null
    entityId?: string
    limit?: number
    offset?: number
  }): Promise<Array<{
    entityId: string
    recordId: string
    tenantId: string
    organizationId: string | null
    presenter?: unknown
    url?: string
  }>> {
    await this.ensureReady()
    // Delegate to vector driver's list method if available
    const listMethod = (this.vectorDriver as unknown as {
      list?: (options: {
        tenantId: string
        organizationId?: string | null
        entityId?: string
        limit?: number
        offset?: number
      }) => Promise<unknown[]>
    }).list

    if (typeof listMethod === 'function') {
      const entries = await listMethod.call(this.vectorDriver, options)
      return entries as Array<{
        entityId: string
        recordId: string
        tenantId: string
        organizationId: string | null
        presenter?: unknown
        url?: string
      }>
    }

    // Fallback: return empty array if driver doesn't support listing
    console.warn('[VectorSearchStrategy] Vector driver does not support listing entries')
    return []
  }
}
