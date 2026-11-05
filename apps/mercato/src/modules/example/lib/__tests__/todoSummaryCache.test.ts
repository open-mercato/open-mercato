/** @jest-environment node */
/**
 * Behavioural coverage for the module-owned Todo summary cache.
 *
 * The fake backend below is deliberately NOT tenant-partitioned: the real cache
 * service wraps every key with the active cache tenant, and if these tests inherited
 * that partitioning they would pass even with a scope-blind logical key. Isolation
 * here has to come from the key and tags this module builds.
 */
import { getCurrentCacheTenant } from '@open-mercato/cache'
import type { CacheStrategy, CacheValue } from '@open-mercato/cache'
import {
  canonicalizeResourceTag,
  deriveResourceFromCommandId,
  expandResourceAliases,
} from '@open-mercato/shared/lib/crud/cache'
import {
  asTodoSummaryForScope,
  buildTodoSummaryCacheKey,
  buildTodoSummaryCacheTags,
  createTodoSummaryCache,
  type TodoSummaryCounts,
  type TodoSummaryScope,
} from '../todoSummaryCache'

const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const TENANT_B = '00000000-0000-4000-8000-00000000000b'
const ORG_A1 = '00000000-0000-4000-8000-0000000000a1'
const ORG_A2 = '00000000-0000-4000-8000-0000000000a2'

const SCOPE_A1: TodoSummaryScope = { tenantId: TENANT_A, organizationId: ORG_A1 }
const SCOPE_A2: TodoSummaryScope = { tenantId: TENANT_A, organizationId: ORG_A2 }
const SCOPE_B1: TodoSummaryScope = { tenantId: TENANT_B, organizationId: ORG_A1 }

type FakeEntry = { value: CacheValue; tags: string[] }

type FakeCache = CacheStrategy & {
  store: Map<string, FakeEntry>
  observedTenants: Array<string | null>
  seed(key: string, value: CacheValue): void
}

function createFakeCache(): FakeCache {
  const store = new Map<string, FakeEntry>()
  const observedTenants: Array<string | null> = []
  const record = () => observedTenants.push(getCurrentCacheTenant())

  return {
    store,
    observedTenants,
    seed(key, value) {
      store.set(key, { value, tags: [] })
    },
    async get(key) {
      record()
      return store.get(key)?.value ?? null
    },
    async set(key, value, options) {
      record()
      store.set(key, { value, tags: options?.tags ?? [] })
    },
    async has(key) {
      return store.has(key)
    },
    async delete(key) {
      return store.delete(key)
    },
    async deleteByTags(tags) {
      record()
      let deleted = 0
      for (const [key, entry] of Array.from(store.entries())) {
        if (entry.tags.some((tag) => tags.includes(tag))) {
          store.delete(key)
          deleted += 1
        }
      }
      return deleted
    },
    async clear() {
      const size = store.size
      store.clear()
      return size
    },
    async keys() {
      return Array.from(store.keys())
    },
    async stats() {
      return { size: store.size, expired: 0 }
    },
  }
}

function countingLoader(counts: TodoSummaryCounts) {
  const calls: TodoSummaryScope[] = []
  const load = jest.fn(async (scope: TodoSummaryScope) => {
    calls.push(scope)
    return counts
  })
  return { load, calls }
}

describe('todo summary cache key and tag scoping', () => {
  it('builds a key that differs for every tenant and every organization', () => {
    const keyA1 = buildTodoSummaryCacheKey(SCOPE_A1)
    expect(keyA1).toBe(`example:todo-summary:tenant:${TENANT_A}:org:${ORG_A1}`)
    expect(buildTodoSummaryCacheKey(SCOPE_A2)).not.toBe(keyA1)
    expect(buildTodoSummaryCacheKey(SCOPE_B1)).not.toBe(keyA1)
  })

  it('tags entries with the exact collection tag the Todo CRUD route invalidates', () => {
    // `makeCrudRoute` derives its cache resource from `events: { module, entity }`,
    // falling back to the command id. Both derivations must land on `example.todo`
    // for the platform's post-commit `invalidateCrudCache` to drop this entry too.
    expect(canonicalizeResourceTag('example.todo')).toBe('example.todo')
    expect(deriveResourceFromCommandId('example.todos.create')).toBe('example.todo')
    expect(expandResourceAliases('example.todo', [])).toEqual(['example.todo'])

    expect(buildTodoSummaryCacheTags(SCOPE_A1)).toEqual([
      `crud:example.todo:tenant:${TENANT_A}:org:${ORG_A1}:collection`,
    ])
    expect(buildTodoSummaryCacheTags(SCOPE_B1)).not.toEqual(buildTodoSummaryCacheTags(SCOPE_A1))
  })
})

describe('todo summary cache-aside reads', () => {
  it('misses once, then serves the same scope from cache', async () => {
    const cache = createFakeCache()
    const loader = countingLoader({ total: 4, done: 1, open: 3 })
    const service = createTodoSummaryCache({ cache, loadCounts: loader.load })

    const first = await service.read(SCOPE_A1)
    expect(first.cacheHit).toBe(false)
    expect(first.summary).toEqual({ total: 4, done: 1, open: 3, ...SCOPE_A1 })

    const second = await service.read(SCOPE_A1)
    expect(second.cacheHit).toBe(true)
    expect(second.summary).toEqual(first.summary)
    expect(loader.load).toHaveBeenCalledTimes(1)
  })

  it('enters the cache tenant context for every backend call', async () => {
    const cache = createFakeCache()
    const service = createTodoSummaryCache({
      cache,
      loadCounts: async () => ({ total: 0, done: 0, open: 0 }),
    })

    await service.read(SCOPE_A1)
    await service.invalidate(SCOPE_A1)

    expect(cache.observedTenants.length).toBeGreaterThanOrEqual(3)
    expect(new Set(cache.observedTenants)).toEqual(new Set([TENANT_A]))
  })

  it('never serves one organization the other organization of the same tenant', async () => {
    const cache = createFakeCache()
    const load = jest.fn(async (scope: TodoSummaryScope) =>
      scope.organizationId === ORG_A1
        ? { total: 7, done: 2, open: 5 }
        : { total: 1, done: 0, open: 1 },
    )
    const service = createTodoSummaryCache({ cache, loadCounts: load })

    await service.read(SCOPE_A1)
    const other = await service.read(SCOPE_A2)

    expect(other.cacheHit).toBe(false)
    expect(other.summary.total).toBe(1)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('never serves one tenant the other tenant of the same organization id', async () => {
    const cache = createFakeCache()
    const load = jest.fn(async (scope: TodoSummaryScope) =>
      scope.tenantId === TENANT_A
        ? { total: 7, done: 2, open: 5 }
        : { total: 2, done: 2, open: 0 },
    )
    const service = createTodoSummaryCache({ cache, loadCounts: load })

    await service.read(SCOPE_A1)
    const other = await service.read(SCOPE_B1)

    expect(other.cacheHit).toBe(false)
    expect(other.summary.total).toBe(2)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('recomputes instead of serving a cached value stamped with another scope', async () => {
    const cache = createFakeCache()
    cache.seed(buildTodoSummaryCacheKey(SCOPE_A1), {
      total: 99,
      done: 99,
      open: 0,
      ...SCOPE_B1,
    })
    const loader = countingLoader({ total: 3, done: 0, open: 3 })
    const service = createTodoSummaryCache({ cache, loadCounts: loader.load })

    const result = await service.read(SCOPE_A1)

    expect(result.cacheHit).toBe(false)
    expect(result.summary.total).toBe(3)
    expect(loader.load).toHaveBeenCalledTimes(1)
  })

  it('recomputes instead of trusting a value of an unexpected shape', async () => {
    const cache = createFakeCache()
    cache.seed(buildTodoSummaryCacheKey(SCOPE_A1), { total: 'many', done: 1, open: 1, ...SCOPE_A1 })
    const loader = countingLoader({ total: 3, done: 0, open: 3 })
    const service = createTodoSummaryCache({ cache, loadCounts: loader.load })

    expect((await service.read(SCOPE_A1)).cacheHit).toBe(false)
    expect(loader.load).toHaveBeenCalledTimes(1)
  })

  it('stores the entry under a bounded TTL', async () => {
    const cache = createFakeCache()
    const setSpy = jest.spyOn(cache, 'set')
    const service = createTodoSummaryCache({
      cache,
      loadCounts: async () => ({ total: 0, done: 0, open: 0 }),
      ttlMs: 1234,
    })

    await service.read(SCOPE_A1)

    expect(setSpy.mock.calls[0][2]).toMatchObject({ ttl: 1234 })
  })
})

describe('todo summary cache invalidation', () => {
  it('drops the scope entry so the next read recomputes', async () => {
    const cache = createFakeCache()
    const loader = countingLoader({ total: 2, done: 1, open: 1 })
    const service = createTodoSummaryCache({ cache, loadCounts: loader.load })

    await service.read(SCOPE_A1)
    expect(await service.invalidate(SCOPE_A1)).toBe(1)

    expect((await service.read(SCOPE_A1)).cacheHit).toBe(false)
    expect(loader.load).toHaveBeenCalledTimes(2)
  })

  it('leaves every other scope cached', async () => {
    const cache = createFakeCache()
    const service = createTodoSummaryCache({
      cache,
      loadCounts: async () => ({ total: 1, done: 0, open: 1 }),
    })

    await service.read(SCOPE_A1)
    await service.read(SCOPE_A2)
    await service.read(SCOPE_B1)

    expect(await service.invalidate(SCOPE_A1)).toBe(1)

    expect((await service.read(SCOPE_A2)).cacheHit).toBe(true)
    expect((await service.read(SCOPE_B1)).cacheHit).toBe(true)
  })
})

describe('asTodoSummaryForScope', () => {
  it('rejects non-objects, negative counts, and foreign scopes', () => {
    expect(asTodoSummaryForScope(null, SCOPE_A1)).toBeNull()
    expect(asTodoSummaryForScope('nope', SCOPE_A1)).toBeNull()
    expect(asTodoSummaryForScope({ total: -1, done: 0, open: 0, ...SCOPE_A1 }, SCOPE_A1)).toBeNull()
    expect(asTodoSummaryForScope({ total: 1, done: 0, open: 1, ...SCOPE_B1 }, SCOPE_A1)).toBeNull()
    expect(asTodoSummaryForScope({ total: 1, done: 0, open: 1, ...SCOPE_A1 }, SCOPE_A1)).toEqual({
      total: 1,
      done: 0,
      open: 1,
      ...SCOPE_A1,
    })
  })
})
