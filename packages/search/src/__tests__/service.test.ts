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

    it('should enrich results when navigation metadata is missing even if presenter title exists', async () => {
      const strategy = createMockStrategy({
        id: 'test',
        search: jest.fn().mockResolvedValue([
          createMockResult({
            presenter: { title: 'Needs Link' },
            url: undefined,
            links: [],
          }),
        ]),
      })
      const presenterEnricher = jest.fn().mockResolvedValue([
        createMockResult({
          presenter: { title: 'Needs Link' },
          url: '/backend/test/rec-123',
          links: [{ href: '/backend/test/rec-123/edit', label: 'Edit', kind: 'secondary' }],
        }),
      ])
      const service = new SearchService({
        strategies: [strategy],
        defaultStrategies: ['test'],
        presenterEnricher,
      })

      const results = await service.search('test', { tenantId: 'tenant-123' })

      expect(presenterEnricher).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            recordId: 'rec-123',
            presenter: { title: 'Needs Link' },
            url: undefined,
            links: [],
          }),
        ]),
        'tenant-123',
        undefined,
      )
      expect(results[0].url).toBe('/backend/test/rec-123')
      expect(results[0].links).toEqual([
        { href: '/backend/test/rec-123/edit', label: 'Edit', kind: 'secondary' },
      ])
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

    it('should throw error when strategy bulkIndex fails', async () => {
      const strategy = createMockStrategy({
        id: 'failing-strategy',
        bulkIndex: jest.fn().mockRejectedValue(new Error('Index strategy failed')),
      })
      const service = new SearchService({ strategies: [strategy] })
      const records = [createMockRecord({ recordId: 'rec-1' })]

      await expect(service.bulkIndex(records)).rejects.toThrow(
        'Bulk indexing failed for 1 strategy(ies): failing-strategy (Index strategy failed)'
      )
    })

    it('should throw error when multiple strategies fail', async () => {
      const strategy1 = createMockStrategy({
        id: 'failing1',
        bulkIndex: jest.fn().mockRejectedValue(new Error('First failure')),
      })
      const strategy2 = createMockStrategy({
        id: 'failing2',
        bulkIndex: jest.fn().mockRejectedValue(new Error('Second failure')),
      })
      const service = new SearchService({ strategies: [strategy1, strategy2] })
      const records = [createMockRecord({ recordId: 'rec-1' })]

      await expect(service.bulkIndex(records)).rejects.toThrow(
        'Bulk indexing failed for 2 strategy(ies): failing1 (First failure), failing2 (Second failure)'
      )
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

  describe('availability checks (issue #1404)', () => {
    it('runs strategy availability probes in parallel, not sequentially', async () => {
      const probeTimings: Record<string, { start: number; end: number }> = {}
      const makeSlowStrategy = (id: string, delayMs: number) =>
        createMockStrategy({
          id,
          isAvailable: jest.fn().mockImplementation(async () => {
            const start = Date.now()
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            probeTimings[id] = { start, end: Date.now() }
            return true
          }),
          search: jest.fn().mockResolvedValue([]),
        })

      const slowA = makeSlowStrategy('slow-a', 60)
      const slowB = makeSlowStrategy('slow-b', 60)
      const slowC = makeSlowStrategy('slow-c', 60)
      const service = new SearchService({
        strategies: [slowA, slowB, slowC],
        defaultStrategies: ['slow-a', 'slow-b', 'slow-c'],
        availabilityCacheTtlMs: 0,
      })

      const start = Date.now()
      await service.search('q', { tenantId: 't-1' })
      const elapsed = Date.now() - start
      const timings = Object.values(probeTimings)
      const latestStart = Math.max(...timings.map((timing) => timing.start))
      const earliestEnd = Math.min(...timings.map((timing) => timing.end))

      // Sequential probes would not overlap. Parallel probes must overlap in time,
      // and total elapsed time should stay well below a fully sequential run.
      expect(timings).toHaveLength(3)
      expect(latestStart).toBeLessThan(earliestEnd)
      expect(elapsed).toBeLessThan(450)
      expect(slowA.isAvailable).toHaveBeenCalledTimes(1)
      expect(slowB.isAvailable).toHaveBeenCalledTimes(1)
      expect(slowC.isAvailable).toHaveBeenCalledTimes(1)
    })

    it('caches positive availability checks within the TTL window', async () => {
      const strategy = createMockStrategy({
        id: 'cached',
        isAvailable: jest.fn().mockResolvedValue(true),
        search: jest.fn().mockResolvedValue([]),
      })
      const service = new SearchService({
        strategies: [strategy],
        defaultStrategies: ['cached'],
        availabilityCacheTtlMs: 60_000,
      })

      await service.search('q', { tenantId: 't-1' })
      await service.search('q', { tenantId: 't-1' })
      await service.search('q', { tenantId: 't-1' })

      expect(strategy.isAvailable).toHaveBeenCalledTimes(1)
    })

    it('caches negative availability checks within the TTL window', async () => {
      const strategy = createMockStrategy({
        id: 'down',
        isAvailable: jest.fn().mockResolvedValue(false),
        search: jest.fn().mockResolvedValue([]),
      })
      const service = new SearchService({
        strategies: [strategy],
        defaultStrategies: ['down'],
        availabilityCacheTtlMs: 60_000,
      })

      await service.search('q', { tenantId: 't-1' })
      await service.search('q', { tenantId: 't-1' })

      expect(strategy.isAvailable).toHaveBeenCalledTimes(1)
    })

    it('caches thrown availability errors as unavailable within the TTL window', async () => {
      const strategy = createMockStrategy({
        id: 'flaky',
        isAvailable: jest.fn().mockRejectedValue(new Error('boom')),
        search: jest.fn().mockResolvedValue([]),
      })
      const service = new SearchService({
        strategies: [strategy],
        defaultStrategies: ['flaky'],
        availabilityCacheTtlMs: 60_000,
      })

      const r1 = await service.search('q', { tenantId: 't-1' })
      const r2 = await service.search('q', { tenantId: 't-1' })

      expect(r1).toEqual([])
      expect(r2).toEqual([])
      expect(strategy.isAvailable).toHaveBeenCalledTimes(1)
      expect(strategy.search).not.toHaveBeenCalled()
    })

    it('coalesces concurrent probes of the same strategy onto a single in-flight call', async () => {
      let resolveProbe: ((value: boolean) => void) | undefined
      const strategy = createMockStrategy({
        id: 'coalesced',
        isAvailable: jest.fn().mockImplementation(
          () =>
            new Promise<boolean>((resolve) => {
              resolveProbe = resolve
            }),
        ),
        search: jest.fn().mockResolvedValue([]),
      })
      const service = new SearchService({
        strategies: [strategy],
        defaultStrategies: ['coalesced'],
        availabilityCacheTtlMs: 0,
      })

      const p1 = service.search('q', { tenantId: 't-1' })
      const p2 = service.search('q', { tenantId: 't-1' })
      const p3 = service.isStrategyAvailable('coalesced')

      // Wait a tick so all three callers register their probes.
      await new Promise((resolve) => setTimeout(resolve, 5))
      resolveProbe?.(true)
      await Promise.all([p1, p2, p3])

      expect(strategy.isAvailable).toHaveBeenCalledTimes(1)
    })

    it('invalidates the availability cache on demand', async () => {
      const strategy = createMockStrategy({
        id: 'invalidated',
        isAvailable: jest.fn().mockResolvedValue(true),
        search: jest.fn().mockResolvedValue([]),
      })
      const service = new SearchService({
        strategies: [strategy],
        defaultStrategies: ['invalidated'],
        availabilityCacheTtlMs: 60_000,
      })

      await service.search('q', { tenantId: 't-1' })
      service.invalidateAvailabilityCache('invalidated')
      await service.search('q', { tenantId: 't-1' })

      expect(strategy.isAvailable).toHaveBeenCalledTimes(2)
    })

    it('invalidates cached availability when a strategy is unregistered and re-registered', async () => {
      const strategy = createMockStrategy({
        id: 'reregistered',
        isAvailable: jest.fn().mockResolvedValue(true),
        search: jest.fn().mockResolvedValue([]),
      })
      const service = new SearchService({
        strategies: [strategy],
        defaultStrategies: ['reregistered'],
        availabilityCacheTtlMs: 60_000,
      })

      await service.search('q', { tenantId: 't-1' })
      service.unregisterStrategy('reregistered')
      service.registerStrategy(strategy)
      await service.search('q', { tenantId: 't-1' })

      expect(strategy.isAvailable).toHaveBeenCalledTimes(2)
    })
  })
})
