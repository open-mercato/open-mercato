import { asValue } from 'awilix'
import type { Kysely } from 'kysely'
import type { FullTextSearchDriver } from './fulltext/types'
import { SearchService } from './service'
import { TokenSearchStrategy } from './strategies/token.strategy'
import { VectorSearchStrategy, type EmbeddingService } from './strategies/vector.strategy'
import { FullTextSearchStrategy } from './strategies/fulltext.strategy'
import { createFulltextDriver } from './fulltext/drivers'
import { SearchIndexer } from './indexer/search-indexer'
import type {
  SearchStrategy,
  ResultMergeConfig,
  SearchModuleConfig,
  SearchFieldPolicy,
  SearchEntityConfig,
  PresenterEnricherFn,
} from './types'
import type { VectorDriver } from './vector/types'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { SearchStrategyId } from '@open-mercato/shared/modules/search'
import type { Queue } from '@open-mercato/queue'
import type { FulltextIndexJobPayload } from './queue/fulltext-indexing'
import type { VectorIndexJobPayload } from './queue/vector-indexing'
import type { EncryptionMapEntry } from './lib/field-policy'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createPresenterEnricher } from './lib/presenter-enricher'

const FULLTEXT_DRIVER_KEY = '__omSearchFulltextDriver__'

type SearchModuleGlobals = {
  [FULLTEXT_DRIVER_KEY]?: FullTextSearchDriver
}

function getSearchModuleGlobals(): SearchModuleGlobals {
  return globalThis as unknown as SearchModuleGlobals
}

/**
 * Check if encrypted fields should be excluded from search indexing.
 * Controlled by SEARCH_EXCLUDE_ENCRYPTED_FIELDS environment variable.
 * Default: false (index all fields including decrypted data)
 */
function shouldExcludeEncryptedFields(): boolean {
  const raw = (process.env.SEARCH_EXCLUDE_ENCRYPTED_FIELDS ?? '').toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

type EncryptionMapRow = {
  id?: unknown
  tenant_id?: unknown
  organization_id?: unknown
  fields_json?: unknown
  created_at?: unknown
}

function compareNullableScope(left: unknown, right: unknown): number {
  if (left == null && right == null) return 0
  if (left == null) return -1
  if (right == null) return 1
  return String(left).localeCompare(String(right))
}

function compareCreatedAt(left: unknown, right: unknown): number {
  const leftTime = left instanceof Date ? left.getTime() : Date.parse(String(left ?? ''))
  const rightTime = right instanceof Date ? right.getTime() : Date.parse(String(right ?? ''))
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime
  return String(left ?? '').localeCompare(String(right ?? ''))
}

function compareEncryptionMapRows(left: EncryptionMapRow, right: EncryptionMapRow): number {
  return compareNullableScope(left.tenant_id, right.tenant_id)
    || compareNullableScope(left.organization_id, right.organization_id)
    || compareCreatedAt(left.created_at, right.created_at)
    || String(left.id ?? '').localeCompare(String(right.id ?? ''))
}

function parseEncryptionMapFields(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mergeEncryptionMapEntries(rows: readonly EncryptionMapRow[]): EncryptionMapEntry[] {
  const merged: EncryptionMapEntry[] = []
  const byField = new Map<string, EncryptionMapEntry>()
  for (const row of [...rows].sort(compareEncryptionMapRows)) {
    for (const candidate of parseEncryptionMapFields(row.fields_json)) {
      if (!candidate || typeof candidate !== 'object') continue
      const rule = candidate as { field?: unknown; hashField?: unknown }
      const field = typeof rule.field === 'string' ? rule.field.trim() : ''
      if (!field) continue
      const hashField = typeof rule.hashField === 'string' && rule.hashField.length > 0
        ? rule.hashField
        : null
      const existing = byField.get(field)
      if (!existing) {
        const entry = { field, hashField }
        byField.set(field, entry)
        merged.push(entry)
      } else if (!existing.hashField && hashField) {
        existing.hashField = hashField
      }
    }
  }
  return merged
}

/**
 * Resolve every active live declaration for an entity. Search indexing has no
 * tenant/scope argument at this boundary, so the safe policy is the union of
 * all scopes: over-excluding a field is preferable to publishing plaintext.
 */
export function createEncryptionMapResolver(
  db: Kysely<any>,
): (entityId: EntityId) => Promise<EncryptionMapEntry[]> {
  const cache = new Map<string, { entries: EncryptionMapEntry[]; expiresAt: number }>()
  const CACHE_TTL_MS = 5 * 60 * 1000

  return async (entityId: EntityId): Promise<EncryptionMapEntry[]> => {
    const cached = cache.get(entityId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.entries
    }

    const rows = await db
      .selectFrom('encryption_maps' as any)
      .select([
        'id' as any,
        'tenant_id' as any,
        'organization_id' as any,
        'fields_json' as any,
        'created_at' as any,
      ])
      .where('entity_id' as any, '=', entityId)
      .where('is_active' as any, '=', true)
      .where('deleted_at' as any, 'is', null)
      .orderBy('tenant_id' as any, 'asc')
      .orderBy('organization_id' as any, 'asc')
      .orderBy('created_at' as any, 'asc')
      .orderBy('id' as any, 'asc')
      .execute() as EncryptionMapRow[]

    const entries = mergeEncryptionMapEntries(Array.isArray(rows) ? rows : [])
    if (entries.length > 0) {
      cache.set(entityId, { entries, expiresAt: Date.now() + CACHE_TTL_MS })
    }
    return entries
  }
}

function createUnavailableEncryptionMapResolver(): (entityId: EntityId) => Promise<EncryptionMapEntry[]> {
  return async () => {
    throw new Error('[internal] Encryption map lookup is unavailable; refusing to index potentially encrypted fields')
  }
}

/**
 * Container interface - minimal subset needed for registration.
 */
export interface SearchContainer {
  resolve<T = unknown>(name: string): T
  register(registrations: Record<string, unknown>): void
}

/**
 * Configuration options for search module registration.
 */
export type SearchModuleOptions = {
  /** Override default strategies to use */
  defaultStrategies?: SearchStrategyId[]
  /** Override merge configuration */
  mergeConfig?: ResultMergeConfig
  /** Skip token strategy registration */
  skipTokens?: boolean
  /** Skip vector strategy registration */
  skipVector?: boolean
  /** Skip fulltext strategy registration */
  skipFulltext?: boolean
  /** Module configurations (from generated/search.generated.ts) */
  moduleConfigs?: SearchModuleConfig[]
}

/**
 * Register the search module in the DI container.
 *
 * This creates and registers:
 * - SearchService instance
 * - All configured search strategies
 *
 * @param container - Awilix container
 * @param options - Optional configuration overrides
 */
export function registerSearchModule(
  container: SearchContainer,
  options?: SearchModuleOptions,
): void {
  const strategies: SearchStrategy[] = []

  // Token strategy (always available unless explicitly skipped)
  if (!options?.skipTokens) {
    try {
      const em = container.resolve<any>('em')
      const db = em.getKysely() as Kysely<any>
      strategies.push(new TokenSearchStrategy(db))
    } catch {
      // Kysely not available via em, skipping TokenSearchStrategy
    }
  }

  // Vector strategy (requires embedding service and driver)
  // Note: We register even if not currently available - availability is checked at search time
  // via isAvailable(). The embedding config may be loaded later from the database.
  if (!options?.skipVector) {
    try {
      const embeddingService = container.resolve<EmbeddingService>('vectorEmbeddingService')
      const drivers = container.resolve<VectorDriver[]>('vectorDrivers')
      const primaryDriver = drivers?.[0]

      if (embeddingService && primaryDriver) {
        strategies.push(new VectorSearchStrategy(embeddingService, primaryDriver))
      }
    } catch {
      // Vector module not available, skipping VectorSearchStrategy
    }
  }

  // Build entity config map for field policy resolution
  const entityConfigMap = new Map<EntityId, SearchEntityConfig>()
  for (const moduleConfig of (options?.moduleConfigs ?? [])) {
    for (const entityConfig of moduleConfig.entities) {
      if (entityConfig.enabled !== false) {
        entityConfigMap.set(entityConfig.entityId as EntityId, entityConfig)
      }
    }
  }

  // Fulltext strategy (requires driver configuration, e.g., MEILISEARCH_HOST)
  if (!options?.skipFulltext) {
    const excludeEncrypted = shouldExcludeEncryptedFields()
    const singletonCacheEnabled = process.env.SEARCH_DISABLE_SINGLETON_CACHE !== '1'
    const g = getSearchModuleGlobals()

    // The fulltext driver is safe to memoize only when SEARCH_EXCLUDE_ENCRYPTED_FIELDS is
    // OFF — in that case the driver holds no request-scoped Kysely reference. When the flag
    // is ON the encryptionMapResolver captures a per-request db handle and must stay
    // per-request to avoid cross-request data leaks.
    const canMemoize = singletonCacheEnabled && !excludeEncrypted

    let fulltextDriver: FullTextSearchDriver | null = canMemoize
      ? (g[FULLTEXT_DRIVER_KEY] ?? null)
      : null

    if (!fulltextDriver) {
      let encryptionMapResolver: ((entityId: EntityId) => Promise<EncryptionMapEntry[]>) | undefined
      if (excludeEncrypted) {
        try {
          const em = container.resolve<any>('em')
          const db = em.getKysely() as Kysely<any>
          encryptionMapResolver = createEncryptionMapResolver(db)
        } catch {
          encryptionMapResolver = createUnavailableEncryptionMapResolver()
        }
      }

      fulltextDriver = createFulltextDriver({
        fieldPolicyResolver: (entityId: EntityId): SearchFieldPolicy | undefined => {
          const config = entityConfigMap.get(entityId)
          return config?.fieldPolicy
        },
        encryptionMapResolver,
      })

      if (canMemoize && fulltextDriver) {
        g[FULLTEXT_DRIVER_KEY] = fulltextDriver
      }
    }

    if (fulltextDriver) {
      strategies.push(new FullTextSearchStrategy(fulltextDriver))
    }
  }

  // Determine default strategies based on what's available
  const defaultStrategies = options?.defaultStrategies ?? determineDefaultStrategies(strategies)

  // Try to resolve queryEngine for reindex support and presenter enrichment
  let queryEngine: QueryEngine | undefined
  try {
    queryEngine = container.resolve<QueryEngine>('queryEngine')
  } catch {
    // QueryEngine not available, reindex will be disabled
  }

  // Resolve encryption service for decrypting presenter data
  let encryptionService: TenantDataEncryptionService | null = null
  try {
    encryptionService = container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  } catch {
    // Encryption service not available, presenters won't be decrypted
  }

  // Create presenter enricher for database-based presenter resolution
  let presenterEnricher: PresenterEnricherFn | undefined
  try {
    const em = container.resolve<any>('em')
    const db = em.getKysely() as Kysely<any>
    presenterEnricher = createPresenterEnricher(db, entityConfigMap, queryEngine, encryptionService)
  } catch {
    // Kysely not available, presenter enrichment disabled
  }

  // Create search service
  const searchService = new SearchService({
    strategies,
    defaultStrategies,
    fallbackStrategy: 'tokens',
    mergeConfig: options?.mergeConfig ?? {
      duplicateHandling: 'highest_score',
      strategyWeights: {
        fulltext: 1.2,
        vector: 1.0,
        tokens: 0.8,
      },
    },
    presenterEnricher,
  })

  // Create search indexer with module configs
  const moduleConfigs = options?.moduleConfigs ?? []

  // Try to resolve fulltextIndexQueue for queue-based reindexing
  let fulltextQueue: Queue<FulltextIndexJobPayload> | undefined
  try {
    fulltextQueue = container.resolve<Queue<FulltextIndexJobPayload>>('fulltextIndexQueue')
  } catch {
    // Queue not available, queue-based fulltext reindex will be disabled
  }

  // Try to resolve vectorIndexQueue for queue-based vector reindexing
  let vectorQueue: Queue<VectorIndexJobPayload> | undefined
  try {
    vectorQueue = container.resolve<Queue<VectorIndexJobPayload>>('vectorIndexQueue')
  } catch {
    // Queue not available, queue-based vector reindex will be disabled
  }

  const searchIndexer = new SearchIndexer(searchService, moduleConfigs, {
    queryEngine,
    fulltextQueue,
    vectorQueue,
  })

  // Register in container
  container.register({
    searchService: asValue(searchService),
    searchStrategies: asValue(strategies),
    searchIndexer: asValue(searchIndexer),
  })
}

/**
 * Determine default strategy order based on available strategies.
 * Prefers fulltext > vector > tokens.
 */
function determineDefaultStrategies(strategies: SearchStrategy[]): SearchStrategyId[] {
  const available = new Set(strategies.map((s) => s.id))
  const defaults: SearchStrategyId[] = []

  if (available.has('fulltext')) defaults.push('fulltext')
  if (available.has('vector')) defaults.push('vector')
  if (available.has('tokens')) defaults.push('tokens')

  return defaults.length > 0 ? defaults : ['tokens']
}

/**
 * Helper to add a custom strategy to an existing SearchService.
 *
 * @param container - DI container
 * @param strategy - Strategy to add
 */
export function addSearchStrategy(container: SearchContainer, strategy: SearchStrategy): void {
  const service = container.resolve<SearchService>('searchService')
  service.registerStrategy(strategy)

  const strategies = container.resolve<SearchStrategy[]>('searchStrategies')
  strategies.push(strategy)
}
