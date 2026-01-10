import { asValue } from 'awilix'
import type { Knex } from 'knex'
import { SearchService } from './service'
import { TokenSearchStrategy } from './strategies/token.strategy'
import { VectorSearchStrategy, type EmbeddingService } from './strategies/vector.strategy'
import { MeilisearchStrategy } from './strategies/meilisearch.strategy'
import { SearchIndexer } from './indexer/search-indexer'
import type { SearchStrategy, ResultMergeConfig, SearchModuleConfig, SearchFieldPolicy, SearchEntityConfig } from './types'
import type { VectorDriver } from './vector/types'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { Queue } from '@open-mercato/queue'
import type { MeilisearchIndexJobPayload } from './queue/meilisearch-indexing'
import type { EncryptionMapEntry } from './lib/field-policy'

/**
 * Check if encrypted fields should be excluded from search indexing.
 * Controlled by SEARCH_EXCLUDE_ENCRYPTED_FIELDS environment variable.
 * Default: false (index all fields including decrypted data)
 */
function shouldExcludeEncryptedFields(): boolean {
  const raw = (process.env.SEARCH_EXCLUDE_ENCRYPTED_FIELDS ?? '').toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

/**
 * Create an encryption map resolver that queries the database.
 * Falls back to empty array if query fails.
 */
function createEncryptionMapResolver(
  knex: Knex,
): (entityId: EntityId) => Promise<EncryptionMapEntry[]> {
  // Cache encryption maps per entity to avoid repeated queries
  const cache = new Map<string, { entries: EncryptionMapEntry[]; expiresAt: number }>()
  const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

  return async (entityId: EntityId): Promise<EncryptionMapEntry[]> => {
    const cached = cache.get(entityId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.entries
    }

    try {
      const rows = await knex('encryption_maps')
        .select('fields_json')
        .where('entity_id', entityId)
        .where('is_active', true)
        .whereNull('deleted_at')
        .first()

      const fieldsJson = rows?.fields_json
      const entries: EncryptionMapEntry[] = Array.isArray(fieldsJson)
        ? fieldsJson.map((f: { field: string; hashField?: string | null }) => ({
            field: f.field,
            hashField: f.hashField ?? null,
          }))
        : []

      cache.set(entityId, { entries, expiresAt: Date.now() + CACHE_TTL_MS })
      return entries
    } catch {
      // Query failed, return empty array (don't exclude any fields)
      return []
    }
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
  defaultStrategies?: string[]
  /** Override merge configuration */
  mergeConfig?: ResultMergeConfig
  /** Skip token strategy registration */
  skipTokens?: boolean
  /** Skip vector strategy registration */
  skipVector?: boolean
  /** Skip meilisearch strategy registration */
  skipMeilisearch?: boolean
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
      const em = container.resolve<{ getConnection: () => { getKnex: () => Knex } }>('em')
      const knex = em.getConnection().getKnex()
      strategies.push(new TokenSearchStrategy(knex))
    } catch {
      // knex not available via em, skipping TokenSearchStrategy
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

  // Meilisearch strategy (requires host configuration)
  if (!options?.skipMeilisearch && process.env.MEILISEARCH_HOST) {
    // Build encryption map resolver if SEARCH_EXCLUDE_ENCRYPTED_FIELDS is enabled
    let encryptionMapResolver: ((entityId: EntityId) => Promise<EncryptionMapEntry[]>) | undefined
    if (shouldExcludeEncryptedFields()) {
      try {
        const em = container.resolve<{ getConnection: () => { getKnex: () => Knex } }>('em')
        const knex = em.getConnection().getKnex()
        encryptionMapResolver = createEncryptionMapResolver(knex)
      } catch {
        // Knex not available, encrypted field filtering disabled
      }
    }

    strategies.push(new MeilisearchStrategy({
      fieldPolicyResolver: (entityId: EntityId): SearchFieldPolicy | undefined => {
        const config = entityConfigMap.get(entityId)
        return config?.fieldPolicy
      },
      encryptionMapResolver,
    }))
  }

  // Determine default strategies based on what's available
  const defaultStrategies = options?.defaultStrategies ?? determineDefaultStrategies(strategies)

  // Create search service
  const searchService = new SearchService({
    strategies,
    defaultStrategies,
    fallbackStrategy: 'tokens',
    mergeConfig: options?.mergeConfig ?? {
      duplicateHandling: 'highest_score',
      strategyWeights: {
        meilisearch: 1.2,
        vector: 1.0,
        tokens: 0.8,
      },
    },
  })

  // Create search indexer with module configs
  const moduleConfigs = options?.moduleConfigs ?? []

  // Try to resolve queryEngine for reindex support
  let queryEngine: QueryEngine | undefined
  try {
    queryEngine = container.resolve<QueryEngine>('queryEngine')
  } catch {
    // QueryEngine not available, reindex will be disabled
  }

  // Try to resolve meilisearchIndexQueue for queue-based reindexing
  let meilisearchQueue: Queue<MeilisearchIndexJobPayload> | undefined
  try {
    meilisearchQueue = container.resolve<Queue<MeilisearchIndexJobPayload>>('meilisearchIndexQueue')
  } catch {
    // Queue not available, queue-based reindex will be disabled
  }

  const searchIndexer = new SearchIndexer(searchService, moduleConfigs, {
    queryEngine,
    meilisearchQueue,
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
 * Prefers meilisearch > vector > tokens.
 */
function determineDefaultStrategies(strategies: SearchStrategy[]): string[] {
  const available = new Set(strategies.map((s) => s.id))
  const defaults: string[] = []

  if (available.has('meilisearch')) defaults.push('meilisearch')
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
