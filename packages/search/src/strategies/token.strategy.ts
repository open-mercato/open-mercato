import type { Knex } from 'knex'
import type {
  SearchStrategy,
  SearchStrategyId,
  SearchOptions,
  SearchResult,
  IndexableRecord,
} from '../types'
import type { EntityId } from '@open-mercato/shared/modules/entities'

/**
 * Configuration for TokenSearchStrategy.
 */
export type TokenStrategyConfig = {
  /** Minimum number of query tokens that must match (0-1 ratio, default 0.5) */
  minMatchRatio?: number
  /** Default limit for search results */
  defaultLimit?: number
}

/**
 * TokenSearchStrategy provides hash-based search using the existing search_tokens table.
 * This strategy is always available and serves as a fallback when other strategies fail.
 *
 * It tokenizes queries into hashes and matches against pre-indexed token hashes,
 * enabling search on encrypted fields without exposing plaintext to external services.
 */
export class TokenSearchStrategy implements SearchStrategy {
  readonly id: SearchStrategyId = 'tokens'
  readonly name = 'Token Search'
  readonly priority = 10 // Lowest priority, always available as fallback

  private readonly minMatchRatio: number
  private readonly defaultLimit: number

  constructor(
    private readonly knex: Knex,
    config?: TokenStrategyConfig,
  ) {
    this.minMatchRatio = config?.minMatchRatio ?? 0.5
    this.defaultLimit = config?.defaultLimit ?? 50
  }

  async isAvailable(): Promise<boolean> {
    return true // Always available
  }

  async ensureReady(): Promise<void> {
    // No initialization needed
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Dynamically import tokenization to avoid circular dependencies
    const { tokenizeText } = await import('@open-mercato/shared/lib/search/tokenize')
    const { resolveSearchConfig } = await import('@open-mercato/shared/lib/search/config')

    const config = resolveSearchConfig()
    if (!config.enabled) return []

    const { hashes } = tokenizeText(query, config)
    if (hashes.length === 0) return []

    const minMatches = Math.max(1, Math.ceil(hashes.length * this.minMatchRatio))
    const limit = options.limit ?? this.defaultLimit

    let queryBuilder = this.knex('search_tokens')
      .select('entity_type', 'entity_id')
      .count('* as match_count')
      .whereIn('token_hash', hashes)
      .where('tenant_id', options.tenantId)
      .groupBy('entity_type', 'entity_id')
      .havingRaw('COUNT(DISTINCT token_hash) >= ?', [minMatches])
      .orderByRaw('COUNT(DISTINCT token_hash) DESC')
      .limit(limit)

    if (options.organizationId) {
      queryBuilder = queryBuilder.where('organization_id', options.organizationId)
    }

    if (options.entityTypes?.length) {
      queryBuilder = queryBuilder.whereIn('entity_type', options.entityTypes)
    }

    const rows = await queryBuilder as Array<{ entity_type: string; entity_id: string; match_count: string | number }>

    return rows.map((row) => {
      const matchCount = typeof row.match_count === 'string'
        ? parseInt(row.match_count, 10)
        : row.match_count
      // Calculate score based on match ratio
      const score = matchCount / hashes.length

      return {
        entityId: row.entity_type as EntityId,
        recordId: row.entity_id,
        score,
        source: this.id,
      }
    })
  }

  async index(record: IndexableRecord): Promise<void> {
    // Dynamically import to avoid circular dependencies
    const { replaceSearchTokensForRecord } = await import(
      '@open-mercato/core/modules/query_index/lib/search-tokens'
    )

    await replaceSearchTokensForRecord(this.knex, {
      entityType: record.entityId,
      recordId: record.recordId,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      doc: record.fields,
    })
  }

  async delete(entityId: EntityId, recordId: string, tenantId: string): Promise<void> {
    // Dynamically import to avoid circular dependencies
    const { deleteSearchTokensForRecord } = await import(
      '@open-mercato/core/modules/query_index/lib/search-tokens'
    )

    await deleteSearchTokensForRecord(this.knex, {
      entityType: entityId,
      recordId,
      tenantId,
    })
  }

  async bulkIndex(records: IndexableRecord[]): Promise<void> {
    if (records.length === 0) return

    const { replaceSearchTokensForBatch } = await import(
      '@open-mercato/core/modules/query_index/lib/search-tokens'
    )

    const payloads = records.map((record) => ({
      entityType: record.entityId,
      recordId: record.recordId,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      doc: record.fields as Record<string, unknown>,
    }))

    await replaceSearchTokensForBatch(this.knex, payloads)
  }

  async purge(entityId: EntityId, tenantId: string): Promise<void> {
    await this.knex('search_tokens')
      .where({ entity_type: entityId, tenant_id: tenantId })
      .del()
  }
}
