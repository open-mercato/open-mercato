import type {
  SearchStrategy,
  SearchStrategyId,
  SearchOptions,
  SearchResult,
  SearchServiceOptions,
  ResultMergeConfig,
  IndexableRecord,
  PresenterEnricherFn,
} from './types'
import { mergeAndRankResults } from './lib/merger'
import { searchError } from './lib/debug'

/**
 * Default merge configuration.
 */
const DEFAULT_MERGE_CONFIG: ResultMergeConfig = {
  duplicateHandling: 'highest_score',
}

/**
 * SearchService orchestrates multiple search strategies, executing searches in parallel
 * and merging results using the RRF algorithm.
 *
 * Features:
 * - Parallel strategy execution for optimal performance
 * - Graceful degradation when strategies fail
 * - Result merging with configurable weights
 * - Strategy availability checking
 *
 * @example
 * ```typescript
 * const service = new SearchService({
 *   strategies: [tokenStrategy, vectorStrategy, fulltextStrategy],
 *   defaultStrategies: ['fulltext', 'vector', 'tokens'],
 *   mergeConfig: {
 *     duplicateHandling: 'highest_score',
 *     strategyWeights: { fulltext: 1.2, vector: 1.0, tokens: 0.8 },
 *   },
 * })
 *
 * const results = await service.search('john doe', { tenantId: 'tenant-123' })
 * ```
 */
export class SearchService {
  private readonly strategies: Map<SearchStrategyId, SearchStrategy>
  private readonly defaultStrategies: SearchStrategyId[]
  private readonly fallbackStrategy: SearchStrategyId | undefined
  private readonly mergeConfig: ResultMergeConfig
  private readonly presenterEnricher?: PresenterEnricherFn

  constructor(options: SearchServiceOptions = {}) {
    this.strategies = new Map()
    for (const strategy of options.strategies ?? []) {
      this.strategies.set(strategy.id, strategy)
    }
    this.defaultStrategies = options.defaultStrategies ?? ['tokens']
    this.fallbackStrategy = options.fallbackStrategy
    this.mergeConfig = options.mergeConfig ?? DEFAULT_MERGE_CONFIG
    this.presenterEnricher = options.presenterEnricher
  }

  /**
   * Get all registered strategies.
   */
  getStrategies(): SearchStrategy[] {
    return Array.from(this.strategies.values())
  }

  /**
   * Execute a search query across configured strategies.
   *
   * @param query - Search query string
   * @param options - Search options with tenant, filters, etc.
   * @returns Merged and ranked search results
   */
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const strategyIds = options.strategies ?? this.defaultStrategies
    const activeStrategies = await this.getAvailableStrategies(strategyIds)

    if (activeStrategies.length === 0) {
      // Try fallback strategy if defined
      if (this.fallbackStrategy) {
        const fallback = await this.getAvailableStrategies([this.fallbackStrategy])
        if (fallback.length > 0) {
          activeStrategies.push(...fallback)
        }
      }
    }

    if (activeStrategies.length === 0) {
      return []
    }

    // Execute searches in parallel with graceful degradation
    const results = await Promise.allSettled(
      activeStrategies.map((strategy) => this.executeStrategySearch(strategy, query, options)),
    )

    // Collect successful results, log failures
    const allResults: SearchResult[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'fulfilled') {
        allResults.push(...result.value)
      } else {
        const strategy = activeStrategies[i]
        searchError('SearchService', 'Strategy search failed', {
          strategyId: strategy?.id,
          error: result.reason instanceof Error ? result.reason.message : result.reason,
        })
      }
    }

    // Merge and rank results
    const merged = mergeAndRankResults(allResults, this.mergeConfig)

    // Enrich results missing presenter data
    return this.enrichResultsWithPresenter(merged, options.tenantId, options.organizationId)
  }

  /**
   * Enrich results that are missing presenter data using the configured enricher.
   * This ensures token-only results get proper titles/subtitles for display.
   */
  private async enrichResultsWithPresenter(
    results: SearchResult[],
    tenantId: string,
    organizationId?: string | null,
  ): Promise<SearchResult[]> {
    // If no enricher configured, return as-is
    if (!this.presenterEnricher) return results

    // Check if any results are missing presenter
    const hasMissing = results.some((r) => !r.presenter?.title)
    if (!hasMissing) return results

    // Use the configured presenter enricher
    try {
      return await this.presenterEnricher(results, tenantId, organizationId)
    } catch {
      // Enrichment failed, return results as-is
      return results
    }
  }

  /**
   * Index a record across all available strategies.
   *
   * @param record - Record to index
   */
  async index(record: IndexableRecord): Promise<void> {
    const strategies = await this.getAvailableStrategies()

    const results = await Promise.allSettled(
      strategies.map((strategy) => this.executeStrategyIndex(strategy, record)),
    )

    // Log any failures
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'rejected') {
        const strategy = strategies[i]
        searchError('SearchService', 'Strategy index failed', {
          strategyId: strategy?.id,
          entityId: record.entityId,
          recordId: record.recordId,
          error: result.reason instanceof Error ? result.reason.message : result.reason,
        })
      }
    }
  }

  /**
   * Delete a record from all strategies.
   *
   * @param entityId - Entity type identifier
   * @param recordId - Record primary key
   * @param tenantId - Tenant for isolation
   */
  async delete(entityId: string, recordId: string, tenantId: string): Promise<void> {
    const strategies = await this.getAvailableStrategies()

    const results = await Promise.allSettled(
      strategies.map((strategy) => this.executeStrategyDelete(strategy, entityId, recordId, tenantId)),
    )

    // Log any failures
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'rejected') {
        const strategy = strategies[i]
        searchError('SearchService', 'Strategy delete failed', {
          strategyId: strategy?.id,
          entityId,
          recordId,
          error: result.reason instanceof Error ? result.reason.message : result.reason,
        })
      }
    }
  }

  /**
   * Bulk index multiple records.
   *
   * @param records - Records to index
   */
  async bulkIndex(records: IndexableRecord[]): Promise<void> {
    if (records.length === 0) return

    const strategies = await this.getAvailableStrategies()

    const results = await Promise.allSettled(
      strategies.map((strategy) => {
        if (strategy.bulkIndex) {
          return strategy.bulkIndex(records)
        }
        // Fallback to individual indexing
        return Promise.all(records.map((record) => this.executeStrategyIndex(strategy, record)))
      }),
    )

    // Log any failures
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'rejected') {
        const strategy = strategies[i]
        searchError('SearchService', 'Strategy bulkIndex failed', {
          strategyId: strategy?.id,
          recordCount: records.length,
          error: result.reason instanceof Error ? result.reason.message : result.reason,
        })
      }
    }
  }

  /**
   * Purge all records for an entity type.
   *
   * @param entityId - Entity type to purge
   * @param tenantId - Tenant for isolation
   */
  async purge(entityId: string, tenantId: string): Promise<void> {
    const strategies = await this.getAvailableStrategies()

    const results = await Promise.allSettled(
      strategies.map((strategy) => {
        if (strategy.purge) {
          return strategy.purge(entityId, tenantId)
        }
        return Promise.resolve()
      }),
    )

    // Log any failures
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'rejected') {
        const strategy = strategies[i]
        searchError('SearchService', 'Strategy purge failed', {
          strategyId: strategy?.id,
          entityId,
          error: result.reason instanceof Error ? result.reason.message : result.reason,
        })
      }
    }
  }

  /**
   * Register a new strategy at runtime.
   *
   * @param strategy - Strategy to register
   */
  registerStrategy(strategy: SearchStrategy): void {
    this.strategies.set(strategy.id, strategy)
  }

  /**
   * Unregister a strategy.
   *
   * @param strategyId - Strategy ID to remove
   */
  unregisterStrategy(strategyId: SearchStrategyId): void {
    this.strategies.delete(strategyId)
  }

  /**
   * Get all registered strategy IDs.
   */
  getRegisteredStrategies(): SearchStrategyId[] {
    return Array.from(this.strategies.keys())
  }

  /**
   * Get a specific strategy by ID.
   *
   * @param strategyId - Strategy ID to retrieve
   * @returns The strategy if registered, undefined otherwise
   */
  getStrategy(strategyId: SearchStrategyId): SearchStrategy | undefined {
    return this.strategies.get(strategyId)
  }

  /**
   * Get the default strategies list.
   */
  getDefaultStrategies(): SearchStrategyId[] {
    return [...this.defaultStrategies]
  }

  /**
   * Check if a specific strategy is available.
   *
   * @param strategyId - Strategy ID to check
   */
  async isStrategyAvailable(strategyId: SearchStrategyId): Promise<boolean> {
    const strategy = this.strategies.get(strategyId)
    if (!strategy) return false
    return strategy.isAvailable()
  }

  /**
   * Get available strategies from the requested list.
   * Filters out strategies that are not registered or not available.
   */
  private async getAvailableStrategies(ids?: SearchStrategyId[]): Promise<SearchStrategy[]> {
    const targetIds = ids ?? Array.from(this.strategies.keys())
    const available: SearchStrategy[] = []

    for (const id of targetIds) {
      const strategy = this.strategies.get(id)
      if (strategy) {
        try {
          const isAvailable = await strategy.isAvailable()
          if (isAvailable) {
            available.push(strategy)
          }
        } catch {
          // Strategy availability check failed, skip it
        }
      }
    }

    // Sort by priority (higher priority first)
    return available.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Execute search on a single strategy with error handling.
   */
  private async executeStrategySearch(
    strategy: SearchStrategy,
    query: string,
    options: SearchOptions,
  ): Promise<SearchResult[]> {
    await strategy.ensureReady()
    return strategy.search(query, options)
  }

  /**
   * Execute index on a single strategy with error handling.
   */
  private async executeStrategyIndex(
    strategy: SearchStrategy,
    record: IndexableRecord,
  ): Promise<void> {
    await strategy.ensureReady()
    return strategy.index(record)
  }

  /**
   * Execute delete on a single strategy with error handling.
   */
  private async executeStrategyDelete(
    strategy: SearchStrategy,
    entityId: string,
    recordId: string,
    tenantId: string,
  ): Promise<void> {
    await strategy.ensureReady()
    return strategy.delete(entityId, recordId, tenantId)
  }
}
