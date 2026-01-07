import type {
  SearchStrategy,
  SearchStrategyId,
  SearchOptions,
  SearchResult,
  SearchServiceOptions,
  ResultMergeConfig,
  IndexableRecord,
} from './types'
import { mergeAndRankResults } from './lib/merger'

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
 *   strategies: [tokenStrategy, vectorStrategy, meilisearchStrategy],
 *   defaultStrategies: ['meilisearch', 'vector', 'tokens'],
 *   mergeConfig: {
 *     duplicateHandling: 'highest_score',
 *     strategyWeights: { meilisearch: 1.2, vector: 1.0, tokens: 0.8 },
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

  constructor(options: SearchServiceOptions = {}) {
    this.strategies = new Map()
    for (const strategy of options.strategies ?? []) {
      this.strategies.set(strategy.id, strategy)
    }
    this.defaultStrategies = options.defaultStrategies ?? ['tokens']
    this.fallbackStrategy = options.fallbackStrategy
    this.mergeConfig = options.mergeConfig ?? DEFAULT_MERGE_CONFIG
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

    // Collect successful results
    const allResults: SearchResult[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allResults.push(...result.value)
      }
      // Failed strategies are silently ignored (graceful degradation)
    }

    // Merge and rank results
    return mergeAndRankResults(allResults, this.mergeConfig)
  }

  /**
   * Index a record across all available strategies.
   *
   * @param record - Record to index
   */
  async index(record: IndexableRecord): Promise<void> {
    const strategies = await this.getAvailableStrategies()

    await Promise.allSettled(
      strategies.map((strategy) => this.executeStrategyIndex(strategy, record)),
    )
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

    await Promise.allSettled(
      strategies.map((strategy) => this.executeStrategyDelete(strategy, entityId, recordId, tenantId)),
    )
  }

  /**
   * Bulk index multiple records.
   *
   * @param records - Records to index
   */
  async bulkIndex(records: IndexableRecord[]): Promise<void> {
    if (records.length === 0) return

    const strategies = await this.getAvailableStrategies()

    await Promise.allSettled(
      strategies.map((strategy) => {
        if (strategy.bulkIndex) {
          return strategy.bulkIndex(records)
        }
        // Fallback to individual indexing
        return Promise.all(records.map((record) => this.executeStrategyIndex(strategy, record)))
      }),
    )
  }

  /**
   * Purge all records for an entity type.
   *
   * @param entityId - Entity type to purge
   * @param tenantId - Tenant for isolation
   */
  async purge(entityId: string, tenantId: string): Promise<void> {
    const strategies = await this.getAvailableStrategies()

    await Promise.allSettled(
      strategies.map((strategy) => {
        if (strategy.purge) {
          return strategy.purge(entityId, tenantId)
        }
        return Promise.resolve()
      }),
    )
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
