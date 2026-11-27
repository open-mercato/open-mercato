import { createHash } from 'crypto'
import type {
  SearchStrategy,
  SearchStrategyId,
  SearchOptions,
  SearchResult,
  IndexableRecord,
} from '../types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { VectorDriver, VectorDriverDocument, VectorDriverListParams } from '../vector/types'
import { searchDebugWarn } from '../lib/debug'
import { plaintextSearchFields } from '../lib/plaintext-fields'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { decryptVectorResultFields } from '../vector/lib/result-decryption'

/** @internal Marks an explicit vector opt-out returned by a configured source. */
export const VECTOR_SOURCE_EXCLUDED = Symbol('vectorSourceExcluded')

/**
 * Embedding service interface - minimal subset needed by VectorSearchStrategy.
 */
export interface EmbeddingService {
  createEmbedding(text: string, options?: { purpose?: 'document' | 'query' }): Promise<number[]>
  available: boolean
}

/**
 * Configuration for VectorSearchStrategy.
 */
export type VectorStrategyConfig = {
  /** Default limit for search results */
  defaultLimit?: number
  encryptionService?: TenantDataEncryptionService | null
}

function normalizeOrganizationIds(options: SearchOptions): string[] | null {
  const single = typeof options.organizationId === 'string' ? options.organizationId.trim() : ''
  if (single) return [single]
  if (!Array.isArray(options.organizationIds)) return null
  return Array.from(new Set(
    options.organizationIds
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0),
  ))
}

/**
 * VectorSearchStrategy provides semantic search using embeddings.
 * It wraps the existing vector module infrastructure.
 */
export class VectorSearchStrategy implements SearchStrategy {
  readonly id: SearchStrategyId = 'vector'
  readonly name = 'Vector Search'
  readonly priority = 20 // Medium priority

  get supportsIndexDocFilter(): boolean {
    return this.vectorDriver.supportsIndexDocFilter === true
  }

  private readonly defaultLimit: number
  private readonly encryptionService: TenantDataEncryptionService | null
  private ready = false
  private readyPromise: Promise<void> | null = null

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorDriver: VectorDriver,
    config?: VectorStrategyConfig,
  ) {
    this.defaultLimit = config?.defaultLimit ?? 20
    this.encryptionService = config?.encryptionService ?? null
  }

  async isAvailable(): Promise<boolean> {
    if (!this.embeddingService.available) return false
    // A configured embedding provider says nothing about the vector store. When the
    // store cannot serve writes (pgvector extension missing), reporting availability
    // here makes SearchService call ensureReady() for every record and fail the whole
    // index/delete operation. Drivers without a probe keep the previous behavior.
    if (!this.vectorDriver.isHealthy) return true
    return this.vectorDriver.isHealthy()
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
    const organizationIds = normalizeOrganizationIds(options)
    if (organizationIds && organizationIds.length === 0) return []
    if (options.indexDocFilter && !this.supportsIndexDocFilter) return []

    await this.ensureReady()
    const embedding = await this.embeddingService.createEmbedding(query, { purpose: 'query' })

    // Build filter - only include organizationId if it's a real value
    // The pgvector driver treats null as "only records with null org_id",
    // but we want null/undefined to mean "no organization filter"
    const filter: {
      tenantId: string
      organizationId?: string | null
      organizationIds?: string[] | null
      entityIds?: EntityId[]
      indexDocFilter?: SearchOptions['indexDocFilter']
    } = {
      tenantId: options.tenantId,
      entityIds: options.entityTypes as EntityId[],
      ...(options.indexDocFilter ? { indexDocFilter: options.indexDocFilter } : {}),
    }

    if (organizationIds) {
      filter.organizationIds = organizationIds
      if (organizationIds.length === 1) {
        filter.organizationId = organizationIds[0]
      }
    }

    const results = await this.vectorDriver.query({
      vector: embedding,
      limit: options.limit ?? this.defaultLimit,
      filter,
    })

    return Promise.all(results.map(async (hit) => {
      const fields = await decryptVectorResultFields({
        tenantId: options.tenantId,
        organizationId: hit.organizationId ?? options.organizationId ?? null,
        resultTitle: hit.resultTitle,
        resultSubtitle: hit.resultSubtitle ?? null,
        resultIcon: hit.resultIcon ?? null,
        resultSnapshot: hit.resultSnapshot ?? null,
        primaryLinkHref: hit.primaryLinkHref ?? null,
        primaryLinkLabel: hit.primaryLinkLabel ?? null,
        links: hit.links ?? null,
        payload: hit.payload ?? null,
      }, this.encryptionService)
      const presenter = this.encryptionService?.isEnabled?.()
        ? {
          title: fields.resultTitle,
          subtitle: fields.resultSubtitle ?? undefined,
          icon: fields.resultIcon ?? undefined,
          badge: hit.presenter?.badge ?? hit.resultBadge ?? undefined,
        }
        : hit.presenter ?? undefined
      return {
        entityId: hit.entityId,
        recordId: hit.recordId,
        score: hit.score,
        source: this.id,
        organizationId: hit.organizationId ?? null,
        presenter,
        url: fields.primaryLinkHref ?? hit.url ?? undefined,
        links: (Array.isArray(fields.links) ? fields.links : undefined)?.map((link) => ({
          href: link.href,
          label: link.label ?? '',
          kind: link.kind,
        })),
        metadata: (typeof fields.payload === 'object' ? fields.payload : undefined) ?? undefined,
      }
    }))
  }

  async index(record: IndexableRecord): Promise<void> {
    if (VECTOR_SOURCE_EXCLUDED in record) {
      await this.delete(record.entityId as EntityId, record.recordId, record.tenantId)
      return
    }

    await this.ensureReady()
    // Use text from buildSource if available, otherwise fall back to generic extraction
    const textContent = record.text !== undefined
      ? (Array.isArray(record.text) ? record.text.join('\n') : record.text)
      : this.buildTextContent(record)
    if (!textContent.trim()) return

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
    await this.ensureReady()
    await this.vectorDriver.delete(entityId, recordId, tenantId)
  }

  async purge(entityId: EntityId, tenantId: string, organizationId?: string | null): Promise<void> {
    await this.ensureReady()
    if (this.vectorDriver.purge) {
      await this.vectorDriver.purge(entityId, tenantId, organizationId)
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
    for (const [, value] of Object.entries(plaintextSearchFields(record))) {
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
  async listEntries(options: VectorDriverListParams): Promise<Array<{
    entityId: string
    recordId: string
    tenantId: string
    organizationId: string | null
    presenter?: unknown
    url?: string
  }>> {
    await this.ensureReady()
    const listMethod = this.vectorDriver.list

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
    searchDebugWarn('VectorSearchStrategy', 'Vector driver does not support listing entries')
    return []
  }
}
