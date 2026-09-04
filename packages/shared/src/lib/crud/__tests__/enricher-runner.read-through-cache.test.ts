import { applyResponseEnrichers, applyResponseEnricherToRecord } from '../enricher-runner'
import { registerResponseEnrichers } from '../enricher-registry'
import type { EnricherContext, ResponseEnricher } from '../response-enricher'

type Record_ = Record<string, unknown>

function createCache() {
  const store = new Map<string, unknown>()
  const set = jest.fn(async (key: string, value: unknown) => {
    store.set(key, value)
  })
  const get = jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null))
  return { store, cache: { get, set } }
}

function createContext(cache: { get: jest.Mock; set: jest.Mock } | null): EnricherContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userFeatures: ['demo.view'],
    container: cache ? { resolve: (name: string) => (name === 'cache' ? cache : null) } : undefined,
  } as unknown as EnricherContext
}

const TARGET = 'demo:widget'

function defineEnricher(
  enrichMany: (records: Record_[]) => Record_[],
  overrides: Partial<ResponseEnricher> = {},
): ResponseEnricher {
  return {
    id: 'demo.enricher',
    targetEntity: TARGET,
    priority: 10,
    cache: { strategy: 'read-through', ttl: 30_000, tags: ['demo:widgets'] },
    async enrichOne(record: Record_) {
      return enrichMany([record])[0]
    },
    async enrichMany(records: Record_[]) {
      return enrichMany(records)
    },
    ...overrides,
  } as ResponseEnricher
}

function register(enricher: ResponseEnricher) {
  registerResponseEnrichers([{ moduleId: 'demo', enrichers: [enricher] }])
}

describe('enricher runner read-through cache', () => {
  beforeEach(() => {
    registerResponseEnrichers([])
  })

  it('serves the enrichment from cache on the second call without re-running the enricher', async () => {
    const { cache } = createCache()
    const enrichMany = jest.fn((records: Record_[]) =>
      records.map((record) => ({ ...record, _demo: { stock: 7 } })),
    )
    register(defineEnricher(enrichMany))

    const items = [{ id: 'a', name: 'first' }]
    const first = await applyResponseEnrichers(items, TARGET, createContext(cache))
    expect(first.items[0]._demo).toEqual({ stock: 7 })
    expect(enrichMany).toHaveBeenCalledTimes(1)

    const second = await applyResponseEnrichers(items, TARGET, createContext(cache))
    expect(second.items[0]._demo).toEqual({ stock: 7 })
    expect(second._meta.enrichedBy).toEqual(['demo.enricher'])
    expect(enrichMany).toHaveBeenCalledTimes(1)
  })

  it('keeps base record fields fresh on a cache hit instead of replaying the cached snapshot', async () => {
    const { cache } = createCache()
    const enrichMany = jest.fn((records: Record_[]) =>
      records.map((record) => ({ ...record, _demo: { stock: 7 } })),
    )
    register(defineEnricher(enrichMany))

    await applyResponseEnrichers([{ id: 'a', name: 'old name' }], TARGET, createContext(cache))

    const second = await applyResponseEnrichers(
      [{ id: 'a', name: 'new name' }],
      TARGET,
      createContext(cache),
    )

    expect(enrichMany).toHaveBeenCalledTimes(1)
    expect(second.items[0].name).toBe('new name')
    expect(second.items[0]._demo).toEqual({ stock: 7 })
  })

  it('does not cache an enricher that mutates a pre-existing field', async () => {
    const { cache } = createCache()
    const enrichMany = jest.fn((records: Record_[]) =>
      records.map((record) => ({ ...record, name: 'rewritten', _demo: { stock: 1 } })),
    )
    register(defineEnricher(enrichMany))

    const items = [{ id: 'a', name: 'original' }]
    await applyResponseEnrichers(items, TARGET, createContext(cache))
    expect(cache.set).not.toHaveBeenCalled()

    const second = await applyResponseEnrichers(items, TARGET, createContext(cache))
    expect(enrichMany).toHaveBeenCalledTimes(2)
    expect(second.items[0].name).toBe('rewritten')
  })

  it('does not cache a batch containing a record without a usable id', async () => {
    const { cache } = createCache()
    const enrichMany = jest.fn((records: Record_[]) =>
      records.map((record) => ({ ...record, _demo: { stock: 3 } })),
    )
    register(defineEnricher(enrichMany))

    await applyResponseEnrichers([{ name: 'no id' }], TARGET, createContext(cache))

    expect(cache.set).not.toHaveBeenCalled()
  })

  it('re-runs the enricher when the cached envelope does not cover every record', async () => {
    const { store, cache } = createCache()
    const enrichMany = jest.fn((records: Record_[]) =>
      records.map((record) => ({ ...record, _demo: { stock: 5 } })),
    )
    register(defineEnricher(enrichMany))

    const items = [{ id: 'a' }, { id: 'b' }]
    await applyResponseEnrichers(items, TARGET, createContext(cache))
    expect(enrichMany).toHaveBeenCalledTimes(1)

    const [cacheKey] = Array.from(store.keys())
    store.set(cacheKey, { version: 1, deltas: { a: { _demo: { stock: 5 } } } })

    const second = await applyResponseEnrichers(items, TARGET, createContext(cache))
    expect(enrichMany).toHaveBeenCalledTimes(2)
    expect(second.items.map((item) => item._demo)).toEqual([{ stock: 5 }, { stock: 5 }])
  })

  it('ignores a cached payload written under a different envelope version', async () => {
    const { store, cache } = createCache()
    const enrichMany = jest.fn((records: Record_[]) =>
      records.map((record) => ({ ...record, _demo: { stock: 9 } })),
    )
    register(defineEnricher(enrichMany))

    const items = [{ id: 'a' }]
    await applyResponseEnrichers(items, TARGET, createContext(cache))

    const [cacheKey] = Array.from(store.keys())
    store.set(cacheKey, { version: 99, deltas: { a: { _demo: { stock: 0 } } } })

    const second = await applyResponseEnrichers(items, TARGET, createContext(cache))
    expect(enrichMany).toHaveBeenCalledTimes(2)
    expect(second.items[0]._demo).toEqual({ stock: 9 })
  })

  it('never touches the cache for an enricher that did not opt in', async () => {
    const { cache } = createCache()
    const enrichMany = jest.fn((records: Record_[]) =>
      records.map((record) => ({ ...record, _demo: { stock: 2 } })),
    )
    register(defineEnricher(enrichMany, { cache: undefined }))

    const items = [{ id: 'a' }]
    await applyResponseEnrichers(items, TARGET, createContext(cache))
    await applyResponseEnrichers(items, TARGET, createContext(cache))

    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(enrichMany).toHaveBeenCalledTimes(2)
  })

  it('writes the enrichment tags alongside the automatic tenant, organization and enricher tags', async () => {
    const { cache } = createCache()
    register(
      defineEnricher((records) => records.map((record) => ({ ...record, _demo: { stock: 1 } }))),
    )

    await applyResponseEnrichers([{ id: 'a' }], TARGET, createContext(cache))

    expect(cache.set).toHaveBeenCalledTimes(1)
    const [, , options] = cache.set.mock.calls[0]
    expect(options.ttl).toBe(30_000)
    expect(options.tags).toEqual(
      expect.arrayContaining([
        'tenant:tenant-1',
        'organization:org-1',
        'enricher:demo.enricher',
        'demo:widgets',
      ]),
    )
  })

  it('caches the single-record path and keeps its base fields fresh', async () => {
    const { cache } = createCache()
    const enrichMany = jest.fn((records: Record_[]) =>
      records.map((record) => ({ ...record, _demo: { stock: 4 } })),
    )
    register(defineEnricher(enrichMany))

    const first = await applyResponseEnricherToRecord(
      { id: 'a', name: 'old' },
      TARGET,
      createContext(cache),
    )
    expect(first.record._demo).toEqual({ stock: 4 })

    const second = await applyResponseEnricherToRecord(
      { id: 'a', name: 'new' },
      TARGET,
      createContext(cache),
    )

    expect(enrichMany).toHaveBeenCalledTimes(1)
    expect(second.record.name).toBe('new')
    expect(second.record._demo).toEqual({ stock: 4 })
  })

  it('runs normally when no cache service is available in the container', async () => {
    const enrichMany = jest.fn((records: Record_[]) =>
      records.map((record) => ({ ...record, _demo: { stock: 6 } })),
    )
    register(defineEnricher(enrichMany))

    const result = await applyResponseEnrichers([{ id: 'a' }], TARGET, createContext(null))

    expect(result.items[0]._demo).toEqual({ stock: 6 })
    expect(enrichMany).toHaveBeenCalledTimes(1)
  })
})
