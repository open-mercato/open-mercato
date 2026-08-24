import { type Kysely, sql, type SqlBool } from 'kysely'
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

const CF_ALIAS_PREFIX = 'cf_'
const CF_CANONICAL_PREFIX = 'cf:'

/**
 * Rewrites the query engine's aliased custom-field keys back to the spelling `search_tokens` is
 * meant to carry.
 *
 * The engine cannot label a column `cf:<key>` — `:` is not a valid SQL identifier — so it sanitizes
 * the alias down to `cf_<key>`. Core's token writer builds from `entity_indexes.doc`, which keeps
 * `cf:<key>`, and both writers replace a record's tokens by deleting only the `(entity_id, field)`
 * pairs their own document carries. Under two spellings neither deletes the other's custom-field
 * rows: every custom field is tokenized twice under names that carry the same hashes, while the
 * base-field rows the two documents share are alternately deleted and re-inserted on every write.
 *
 * `cf:` is the side to converge on because it is the side that is read — the query engine's search
 * predicate and every caller of `findEntityIdsBySearchTokens` ask for `cf:<key>`.
 *
 * Deliberately scoped to the rows this strategy writes rather than applied to
 * `IndexableRecord.fields` upstream: the same object is handed to the fulltext driver, and
 * Meilisearch rejects an attribute name containing `:`.
 */
function normalizeCustomFieldKeys(
  fields: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!fields) return fields
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith(CF_ALIAS_PREFIX)) {
      normalized[key] = value
      continue
    }
    const canonical = `${CF_CANONICAL_PREFIX}${key.slice(CF_ALIAS_PREFIX.length)}`
    // A document carrying both spellings meant the explicit one; the alias is the sanitizer's
    // output for the same field.
    if (canonical in fields) continue
    normalized[canonical] = value
  }
  return normalized
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
    private readonly db: Kysely<any>,
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
    const organizationIds = normalizeOrganizationIds(options)
    if (organizationIds && organizationIds.length === 0) return []

    // Dynamically import tokenization to avoid circular dependencies
    const { tokenizeText } = await import('@open-mercato/shared/lib/search/tokenize')
    const { resolveSearchConfig } = await import('@open-mercato/shared/lib/search/config')
    const { listSearchTokenExcludedEntityTypes } = await import(
      '@open-mercato/core/modules/query_index/lib/search-entity-policy'
    )

    const config = resolveSearchConfig()
    if (!config.enabled) return []

    // The rows themselves stay in `search_tokens` — list routes and the query engines' encrypted
    // like/ilike rewrite depend on them — so the exclusion is enforced here, at read time.
    const excludedEntityTypes = listSearchTokenExcludedEntityTypes()
    const requestedEntityTypes = options.entityTypes?.length
      ? options.entityTypes.filter((entityType) => !excludedEntityTypes.includes(entityType))
      : undefined
    if (options.entityTypes?.length && !requestedEntityTypes?.length) return []

    const { hashes } = tokenizeText(query, config)
    if (hashes.length === 0) return []

    const minMatches = Math.max(1, Math.ceil(hashes.length * this.minMatchRatio))
    const limit = options.limit ?? this.defaultLimit

    let queryBuilder = this.db
      .selectFrom('search_tokens' as any)
      .select([
        'entity_type' as any,
        'entity_id' as any,
        'organization_id' as any,
        sql<string>`count(*)`.as('match_count'),
      ])
      .where('token_hash' as any, 'in', hashes)
      .where('tenant_id' as any, '=', options.tenantId)
      .groupBy(['entity_type' as any, 'entity_id' as any, 'organization_id' as any])
      .having(sql<SqlBool>`count(distinct token_hash) >= ${minMatches}`)
      .orderBy(sql`count(distinct token_hash) desc`)
      .limit(limit)

    if (organizationIds) {
      queryBuilder = queryBuilder.where('organization_id' as any, 'in', organizationIds)
    }

    if (requestedEntityTypes?.length) {
      queryBuilder = queryBuilder.where('entity_type' as any, 'in', requestedEntityTypes)
    } else if (excludedEntityTypes.length) {
      queryBuilder = queryBuilder.where('entity_type' as any, 'not in', excludedEntityTypes)
    }

    const rows = await queryBuilder.execute() as Array<{
      entity_type: string
      entity_id: string
      organization_id: string | null
      match_count: string | number
    }>

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
        organizationId: row.organization_id ?? null,
      }
    })
  }

  async index(record: IndexableRecord): Promise<void> {
    // Dynamically import to avoid circular dependencies
    const { replaceSearchTokensForRecord } = await import(
      '@open-mercato/core/modules/query_index/lib/search-tokens'
    )

    await replaceSearchTokensForRecord(this.db, {
      entityType: record.entityId,
      recordId: record.recordId,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      doc: normalizeCustomFieldKeys(record.fields),
    })
  }

  async delete(entityId: EntityId, recordId: string, tenantId: string): Promise<void> {
    // Dynamically import to avoid circular dependencies
    const { deleteSearchTokensForRecord } = await import(
      '@open-mercato/core/modules/query_index/lib/search-tokens'
    )

    await deleteSearchTokensForRecord(this.db, {
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
      doc: normalizeCustomFieldKeys(record.fields) as Record<string, unknown>,
    }))

    await replaceSearchTokensForBatch(this.db, payloads)
  }

  async purge(entityId: EntityId, tenantId: string, organizationId?: string | null): Promise<void> {
    const normalizedOrganizationId =
      typeof organizationId === 'string' && organizationId.trim().length > 0 ? organizationId.trim() : null
    let query = this.db
      .deleteFrom('search_tokens' as any)
      .where('entity_type' as any, '=', entityId)
      .where('tenant_id' as any, '=', tenantId)
    if (normalizedOrganizationId !== null) {
      query = query.where('organization_id' as any, '=', normalizedOrganizationId)
    }
    await query.execute()
  }
}
