import type { EntityManager } from '@mikro-orm/postgresql'
import { computeAvailabilityCached, invalidateWmsAvailabilityCache, WMS_AVAILABILITY_CACHE_TAG } from '../availabilityCache'
import type { AvailabilityQuery } from '@open-mercato/shared/lib/availability'

const TENANT = 'tenant-1'
const ORG = 'org-1'

function makeQuery(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    tenantId: TENANT,
    organizationId: ORG,
    items: [{ catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 }],
    ...overrides,
  }
}

function makeEm(): EntityManager {
  const execute = jest.fn().mockResolvedValue([])
  return { getConnection: () => ({ execute }) } as unknown as EntityManager
}

function makeCache() {
  const store = new Map<string, { value: unknown; tags: string[] }>()
  return {
    get: jest.fn(async (key: string) => store.get(key)?.value ?? null),
    set: jest.fn(async (key: string, value: unknown, options?: { tags?: string[] }) => {
      store.set(key, { value, tags: options?.tags ?? [] })
    }),
    deleteByTags: jest.fn(async (tags: string[]) => {
      let count = 0
      for (const [key, entry] of store.entries()) {
        if (entry.tags.some((tag) => tags.includes(tag))) {
          store.delete(key)
          count += 1
        }
      }
      return count
    }),
    _store: store,
  }
}

function makeContainer(cache: ReturnType<typeof makeCache> | null, policyResolveMany?: unknown) {
  return {
    resolve: <T,>(name: string): T => {
      if (name === 'cache' && cache) return cache as unknown as T
      if (name === 'policyResolutionService' && policyResolveMany) return { resolveMany: policyResolveMany } as unknown as T
      throw new Error(`not registered: ${name}`)
    },
  }
}

describe('computeAvailabilityCached', () => {
  it('computes live and marks isAuthoritative true when no cache service is registered', async () => {
    const em = makeEm()
    const result = await computeAvailabilityCached(em, makeContainer(null), makeQuery())
    expect(result.byItem['p1:v1'].isAuthoritative).toBe(true)
  })

  it('caches a computed result and serves the next read from cache with isAuthoritative false', async () => {
    const em = makeEm()
    const cache = makeCache()
    const container = makeContainer(cache)
    const first = await computeAvailabilityCached(em, container, makeQuery())
    expect(first.byItem['p1:v1'].isAuthoritative).toBe(true)
    expect(cache.set).toHaveBeenCalledTimes(1)

    const second = await computeAvailabilityCached(em, container, makeQuery())
    expect(second.byItem['p1:v1'].isAuthoritative).toBe(false)
    expect(cache.get).toHaveBeenCalled()
  })

  it('always computes live when bypassCache is set, never reading or writing the cache', async () => {
    const em = makeEm()
    const cache = makeCache()
    const container = makeContainer(cache)
    const result = await computeAvailabilityCached(em, container, makeQuery({ bypassCache: true }))
    expect(result.byItem['p1:v1'].isAuthoritative).toBe(true)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })
})

describe('invalidateWmsAvailabilityCache', () => {
  it('clears every entry tagged with the availability cache tag', async () => {
    const em = makeEm()
    const cache = makeCache()
    const container = makeContainer(cache)
    await computeAvailabilityCached(em, container, makeQuery())
    expect(cache._store.size).toBe(1)

    await invalidateWmsAvailabilityCache(container, TENANT)
    expect(cache.deleteByTags).toHaveBeenCalledWith([WMS_AVAILABILITY_CACHE_TAG])
    expect(cache._store.size).toBe(0)
  })

  it('no-ops without throwing when no cache service is registered', async () => {
    await expect(invalidateWmsAvailabilityCache(makeContainer(null), TENANT)).resolves.toBeUndefined()
  })

  it('no-ops when tenantId is null', async () => {
    const cache = makeCache()
    await invalidateWmsAvailabilityCache(makeContainer(cache), null)
    expect(cache.deleteByTags).not.toHaveBeenCalled()
  })
})
