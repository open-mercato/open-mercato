import { SearchService } from '../service'
import { SearchStrategy, SearchResult, IndexableRecord } from '../types'

/**
 * Create a mock search strategy for testing
 */
function createMockStrategy(overrides: Partial<SearchStrategy> = {}): SearchStrategy {
  return {
    id: 'mock',
    name: 'Mock Strategy',
    priority: 10,
    isAvailable: jest.fn().mockResolvedValue(true),
    ensureReady: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockResolvedValue([]),
    index: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    bulkIndex: jest.fn().mockResolvedValue(undefined),
    purge: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/**
 * Create a mock search result for testing
 */
function createMockResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    entityId: 'test:entity',
    recordId: 'rec-123',
    score: 0.9,
    source: 'mock',
    presenter: { title: 'Test Result' },
    ...overrides,
  }
}

/**
 * Create a mock indexable record for testing
 */
function createMockRecord(overrides: Partial<IndexableRecord> = {}): IndexableRecord {
  return {
    entityId: 'test:entity',
    recordId: 'rec-123',
    tenantId: 'tenant-123',
    organizationId: 'org-456',
    fields: { name: 'Test' },
    presenter: { title: 'Test Record' },
    ...overrides,
  }
}

describe('SearchService', () => {
  describe('constructor', () => {
    it('should create service with no strategies', () => {
      const service = new SearchService()
      expect(service.getRegisteredStrategies()).toEqual([])
    })

    it('should create service with provided strategies', () => {
      const strategy = createMockStrategy({ id: 'test' })
      const service = new SearchService({ strategies: [strategy] })
      expect(service.getRegisteredStrategies()).toContain('test')
    })

    it('should use default strategies when not specified', () => {
      const service = new SearchService()
      expect(service.getDefaultStrategies()).toEqual(['tokens'])
    })

    it('should use custom default strategies when provided', () => {
      const service = new SearchService({
        defaultStrategies: ['meilisearch', 'vector'],
      })
      expect(service.getDefaultStrategies()).toEqual(['meilisearch', 'vector'])
    })
  })

  describe('strategy management', () => {
    it('should register a strategy', () => {
      const service = new SearchService()
      const strategy = createMockStrategy({ id: 'new-strategy' })

      service.registerStrategy(strategy)

      expect(service.getRegisteredStrategies()).toContain('new-strategy')
      expect(service.getStrategy('new-strategy')).toBe(strategy)
    })

    it('should unregister a strategy', () => {
      const strategy = createMockStrategy({ id: 'test' })
      const service = new SearchService({ strategies: [strategy] })

      service.unregisterStrategy('test')

      expect(service.getRegisteredStrategies()).not.toContain('test')
      expect(service.getStrategy('test')).toBeUndefined()
    })

    it('should check strategy availability', async () => {
      const availableStrategy = createMockStrategy({
        id: 'available',
        isAvailable: jest.fn().mockResolvedValue(true),
      })
      const unavailableStrategy = createMockStrategy({
        id: 'unavailable',
        isAvailable: jest.fn().mockResolvedValue(false),
      })
      const service = new SearchService({
        strategies: [availableStrategy, unavailableStrategy],
      })

      expect(await service.isStrategyAvailable('available')).toBe(true)
      expect(await service.isStrategyAvailable('unavailable')).toBe(false)
      expect(await service.isStrategyAvailable('nonexistent')).toBe(false)
    })
  })

  describe('search', () => {
    it('should return empty array when no strategies available', async () => {
      const service = new SearchService()

      const results = await service.search('test query', { tenantId: 'tenant-123' })

      expect(results).toEqual([])
    })

    it('should execute search on available strategies', async () => {
      const mockResults = [createMockResult()]
      const strategy = createMockStrategy({
        id: 'test',
        search: jest.fn().mockResolvedValue(mockResults),
      })
      const service = new SearchService({
        strategies: [strategy],
        defaultStrategies: ['test'],
      })

      const results = await service.search('test query', { tenantId: 'tenant-123' })

      expect(strategy.ensureReady).toHaveBeenCalled()
      expect(strategy.search).toHaveBeenCalledWith('test query', { tenantId: 'tenant-123' })
      expect(results).toHaveLength(1)
      expect(results[0].recordId).toBe('rec-123')
    })

    it('should skip unavailable strategies', async () => {
      const availableStrategy = createMockStrategy({
        id: 'available',
        isAvailable: jest.fn().mockResolvedValue(true),
        search: jest.fn().mockResolvedValue([createMockResult({ source: 'available' })]),
      })
      const unavailableStrategy = createMockStrategy({
        id: 'unavailable',
        isAvailable: jest.fn().mockResolvedValue(false),
        search: jest.fn().mockResolvedValue([createMockResult({ source: 'unavailable' })]),
      })
      const service = new SearchService({
        strategies: [availableStrategy, unavailableStrategy],
        defaultStrategies: ['available', 'unavailable'],
      })

      const results = await service.search('test', { tenantId: 'tenant-123' })

      expect(unavailableStrategy.search).not.toHaveBeenCalled()
      expect(results.every((r) => r.source === 'available')).toBe(true)
    })

    it('should merge results from multiple strategies', async () => {
      const strategy1 = createMockStrategy({
        id: 'strategy1',
        priority: 20,
        search: jest.fn().mockResolvedValue([
          createMockResult({ recordId: 'rec-1', source: 'strategy1', score: 0.9 }),
        ]),
      })
      const strategy2 = createMockStrategy({
        id: 'strategy2',
        priority: 10,
        search: jest.fn().mockResolvedValue([
          createMockResult({ recordId: 'rec-2', source: 'strategy2', score: 0.8 }),
        ]),
      })
      const service = new SearchService({
        strategies: [strategy1, strategy2],
        defaultStrategies: ['strategy1', 'strategy2'],
      })

      const results = await service.search('test', { tenantId: 'tenant-123' })

      expect(results).toHaveLength(2)
    })

    it('should handle strategy search failures gracefully', async () => {
      const failingStrategy = createMockStrategy({
        id: 'failing',
        search: jest.fn().mockRejectedValue(new Error('Search failed')),
      })
      const workingStrategy = createMockStrategy({
        id: 'working',
        search: jest.fn().mockResolvedValue([createMockResult({ source: 'working' })]),
      })
      const service = new SearchService({
        strategies: [failingStrategy, workingStrategy],
        defaultStrategies: ['failing', 'working'],
      })

      const results = await service.search('test', { tenantId: 'tenant-123' })

      // Should return results from working strategy despite failing strategy
      expect(results).toHaveLength(1)
      expect(results[0].source).toBe('working')
    })

    it('should use fallback strategy when no default strategies available', async () => {
      const fallbackStrategy = createMockStrategy({
        id: 'fallback',
        search: jest.fn().mockResolvedValue([createMockResult({ source: 'fallback' })]),
      })
      const unavailableStrategy = createMockStrategy({
        id: 'primary',
        isAvailable: jest.fn().mockResolvedValue(false),
      })
      const service = new SearchService({
        strategies: [unavailableStrategy, fallbackStrategy],
        defaultStrategies: ['primary'],
        fallbackStrategy: 'fallback',
      })

      const results = await service.search('test', { tenantId: 'tenant-123' })

      expect(results).toHaveLength(1)
      expect(results[0].source).toBe('fallback')
    })
  })

  describe('index', () => {
    it('should index record on all available strategies', async () => {
      const strategy1 = createMockStrategy({ id: 'strategy1' })
      const strategy2 = createMockStrategy({ id: 'strategy2' })
      const service = new SearchService({
        strategies: [strategy1, strategy2],
      })
      const record = createMockRecord()

      await service.index(record)

      expect(strategy1.index).toHaveBeenCalledWith(record)
      expect(strategy2.index).toHaveBeenCalledWith(record)
    })

    it('should skip unavailable strategies', async () => {
      const availableStrategy = createMockStrategy({
        id: 'available',
        isAvailable: jest.fn().mockResolvedValue(true),
      })
      const unavailableStrategy = createMockStrategy({
        id: 'unavailable',
        isAvailable: jest.fn().mockResolvedValue(false),
      })
      const service = new SearchService({
        strategies: [availableStrategy, unavailableStrategy],
      })
      const record = createMockRecord()

      await service.index(record)

      expect(availableStrategy.index).toHaveBeenCalled()
      expect(unavailableStrategy.index).not.toHaveBeenCalled()
    })
  })

  describe('bulkIndex', () => {
    it('should bulk index records on strategies that support it', async () => {
      const strategy = createMockStrategy({
        id: 'test',
        bulkIndex: jest.fn().mockResolvedValue(undefined),
      })
      const service = new SearchService({ strategies: [strategy] })
      const records = [createMockRecord({ recordId: 'rec-1' }), createMockRecord({ recordId: 'rec-2' })]

      await service.bulkIndex(records)

      expect(strategy.bulkIndex).toHaveBeenCalledWith(records)
    })

    it('should fallback to individual indexing when bulkIndex not supported', async () => {
      const strategy = createMockStrategy({
        id: 'test',
        bulkIndex: undefined,
        index: jest.fn().mockResolvedValue(undefined),
      })
      const service = new SearchService({ strategies: [strategy] })
      const records = [createMockRecord({ recordId: 'rec-1' }), createMockRecord({ recordId: 'rec-2' })]

      await service.bulkIndex(records)

      expect(strategy.index).toHaveBeenCalledTimes(2)
    })

    it('should do nothing when records array is empty', async () => {
      const strategy = createMockStrategy({ id: 'test' })
      const service = new SearchService({ strategies: [strategy] })

      await service.bulkIndex([])

      expect(strategy.bulkIndex).not.toHaveBeenCalled()
      expect(strategy.index).not.toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    it('should delete from all available strategies', async () => {
      const strategy1 = createMockStrategy({ id: 'strategy1' })
      const strategy2 = createMockStrategy({ id: 'strategy2' })
      const service = new SearchService({
        strategies: [strategy1, strategy2],
      })

      await service.delete('test:entity', 'rec-123', 'tenant-123')

      expect(strategy1.delete).toHaveBeenCalledWith('test:entity', 'rec-123', 'tenant-123')
      expect(strategy2.delete).toHaveBeenCalledWith('test:entity', 'rec-123', 'tenant-123')
    })
  })

  describe('purge', () => {
    it('should purge from strategies that support it', async () => {
      const strategyWithPurge = createMockStrategy({
        id: 'with-purge',
        purge: jest.fn().mockResolvedValue(undefined),
      })
      const strategyWithoutPurge = createMockStrategy({
        id: 'without-purge',
        purge: undefined,
      })
      const service = new SearchService({
        strategies: [strategyWithPurge, strategyWithoutPurge],
      })

      await service.purge('test:entity', 'tenant-123')

      expect(strategyWithPurge.purge).toHaveBeenCalledWith('test:entity', 'tenant-123')
    })
  })
})
