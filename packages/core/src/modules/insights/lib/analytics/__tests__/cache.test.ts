import { z } from 'zod'
import { createCacheService, runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import {
  XRAY_ANALYTICS_TENANT_WIDE_TAG,
  analyticsCacheTags,
  buildAnalyticsCacheKey,
  canonicalJson,
  createAnalyticsCache,
  createAnalyticsCacheState,
  organizationCacheTag,
  permissionFingerprint,
} from '../cache'
import type { AnalyticsViewer } from '../types'
import { ANALYTICS_ORG, ANALYTICS_OTHER_ORG } from './analyticsTestSupport'

const TENANT = '11111111-0000-4000-8000-000000000001'
const OTHER_TENANT = '11111111-0000-4000-8000-000000000002'
const valueSchema = z.object({ value: z.number() })

const ADMIN: AnalyticsViewer = { userId: '33333333-0000-4000-8000-000000000001', features: ['insights.xray.view', 'customers.*'], canViewIndividuals: false }
const MANAGER: AnalyticsViewer = { userId: '33333333-0000-4000-8000-000000000002', features: ['insights.xray.view'], canViewIndividuals: false }

function keyFor(viewer: AnalyticsViewer, options: { perPerson?: boolean; organizationIds?: string[] | null; tenantId?: string; params?: unknown } = {}): string {
  return buildAnalyticsCacheKey({
    tenantId: options.tenantId ?? TENANT,
    organizationIds: options.organizationIds === undefined ? [ANALYTICS_ORG] : options.organizationIds,
    permissionFingerprint: permissionFingerprint(viewer, { perPerson: options.perPerson === true }),
    settingsFingerprint: 'settings',
    operation: 'map',
    params: options.params ?? { window: { from: 'a', to: 'b' } },
  })
}

function deferred<TValue>() {
  let resolve: (value: TValue) => void = () => undefined
  const promise = new Promise<TValue>((done) => { resolve = done })
  return { promise, resolve }
}

describe('X-Ray analytics cache', () => {
  it('keys results by tenant, organization filter, permission fingerprint, settings and canonical params', () => {
    expect(keyFor(ADMIN)).not.toBe(keyFor(MANAGER))
    expect(keyFor(ADMIN)).toBe(keyFor({ ...ADMIN, userId: MANAGER.userId, features: ['customers.*', 'insights.xray.view', 'customers.*'] }))
    expect(keyFor(ADMIN, { perPerson: true })).not.toBe(keyFor({ ...ADMIN, userId: MANAGER.userId }, { perPerson: true }))
    expect(keyFor(ADMIN, { organizationIds: [ANALYTICS_OTHER_ORG, ANALYTICS_ORG] })).toBe(keyFor(ADMIN, { organizationIds: [ANALYTICS_ORG, ANALYTICS_OTHER_ORG] }))
    expect(keyFor(ADMIN, { organizationIds: null })).not.toBe(keyFor(ADMIN, { organizationIds: [ANALYTICS_ORG] }))
    expect(keyFor(ADMIN, { tenantId: OTHER_TENANT })).not.toBe(keyFor(ADMIN))
    expect(keyFor(ADMIN, { params: { b: 1, a: 2 } })).toBe(keyFor(ADMIN, { params: { a: 2, b: 1 } }))
    expect(keyFor(ADMIN, { params: { a: 1 } })).not.toBe(keyFor(ADMIN, { params: { a: 2 } }))
    expect(canonicalJson({ b: [{ d: 1, c: undefined, a: 2 }], a: null })).toBe('{"a":null,"b":[{"a":2,"d":1}]}')
    expect(analyticsCacheTags(null)).toEqual([XRAY_ANALYTICS_TENANT_WIDE_TAG, 'insights:xray:analytics'])
    expect(analyticsCacheTags([ANALYTICS_OTHER_ORG, ANALYTICS_ORG])).toEqual([organizationCacheTag(ANALYTICS_ORG), organizationCacheTag(ANALYTICS_OTHER_ORG), 'insights:xray:analytics'])
  })

  it('shares one computation between concurrent identical requests (single-flight) and caches the result', async () => {
    const analytics = createAnalyticsCache(createCacheService({ strategy: 'memory' }), createAnalyticsCacheState())
    const gate = deferred<{ value: number }>()
    const compute = jest.fn(() => gate.promise)
    const entry = { key: keyFor(ADMIN), tenantId: TENANT, tags: analyticsCacheTags([ANALYTICS_ORG]), schema: valueSchema }
    const first = analytics.getOrCompute(entry, compute)
    const second = analytics.getOrCompute(entry, compute)
    await new Promise((resolve) => setImmediate(resolve))
    gate.resolve({ value: 42 })
    expect(await Promise.all([first, second])).toEqual([{ value: 42 }, { value: 42 }])
    expect(compute).toHaveBeenCalledTimes(1)
    expect(await analytics.getOrCompute(entry, async () => ({ value: 7 }))).toEqual({ value: 42 })
  })

  it('isolates two viewers with different permission fingerprints and two tenants', async () => {
    const analytics = createAnalyticsCache(createCacheService({ strategy: 'memory' }), createAnalyticsCacheState())
    const tags = analyticsCacheTags([ANALYTICS_ORG])
    await analytics.getOrCompute({ key: keyFor(ADMIN), tenantId: TENANT, tags, schema: valueSchema }, async () => ({ value: 1 }))
    const manager = await analytics.getOrCompute({ key: keyFor(MANAGER), tenantId: TENANT, tags, schema: valueSchema }, async () => ({ value: 2 }))
    expect(manager).toEqual({ value: 2 })
    const otherTenant = await analytics.getOrCompute({ key: keyFor(ADMIN), tenantId: OTHER_TENANT, tags, schema: valueSchema }, async () => ({ value: 3 }))
    expect(otherTenant).toEqual({ value: 3 })
    expect(await analytics.getOrCompute({ key: keyFor(ADMIN), tenantId: TENANT, tags, schema: valueSchema }, async () => ({ value: 9 }))).toEqual({ value: 1 })
  })

  it('invalidates by organization tag (and every tenant-wide result) without touching other organizations or tenants', async () => {
    const analytics = createAnalyticsCache(createCacheService({ strategy: 'memory' }), createAnalyticsCacheState())
    const own = { key: keyFor(ADMIN), tenantId: TENANT, tags: analyticsCacheTags([ANALYTICS_ORG]), schema: valueSchema }
    const other = { key: keyFor(ADMIN, { organizationIds: [ANALYTICS_OTHER_ORG] }), tenantId: TENANT, tags: analyticsCacheTags([ANALYTICS_OTHER_ORG]), schema: valueSchema }
    const wide = { key: keyFor(ADMIN, { organizationIds: null }), tenantId: TENANT, tags: analyticsCacheTags(null), schema: valueSchema }
    const foreign = { ...own, tenantId: OTHER_TENANT }
    for (const entry of [own, other, wide, foreign]) await analytics.getOrCompute(entry, async () => ({ value: 1 }))
    await analytics.invalidate(TENANT, [ANALYTICS_ORG])
    expect(await analytics.getOrCompute(own, async () => ({ value: 2 }))).toEqual({ value: 2 })
    expect(await analytics.getOrCompute(wide, async () => ({ value: 2 }))).toEqual({ value: 2 })
    expect(await analytics.getOrCompute(other, async () => ({ value: 2 }))).toEqual({ value: 1 })
    expect(await analytics.getOrCompute(foreign, async () => ({ value: 2 }))).toEqual({ value: 1 })
  })

  it('does not store a result computed across an invalidation and starts a fresh computation afterwards', async () => {
    const analytics = createAnalyticsCache(createCacheService({ strategy: 'memory' }), createAnalyticsCacheState())
    const entry = { key: keyFor(ADMIN), tenantId: TENANT, tags: analyticsCacheTags([ANALYTICS_ORG]), schema: valueSchema }
    const gate = deferred<{ value: number }>()
    const stale = analytics.getOrCompute(entry, () => gate.promise)
    await new Promise((resolve) => setImmediate(resolve))
    await analytics.invalidate(TENANT, [ANALYTICS_ORG])
    const fresh = analytics.getOrCompute(entry, async () => ({ value: 2 }))
    gate.resolve({ value: 1 })
    expect(await stale).toEqual({ value: 1 })
    expect(await fresh).toEqual({ value: 2 })
    expect(await analytics.getOrCompute(entry, async () => ({ value: 3 }))).toEqual({ value: 2 })
  })

  it('propagates a failed computation to every waiter without caching it', async () => {
    const analytics = createAnalyticsCache(createCacheService({ strategy: 'memory' }), createAnalyticsCacheState())
    const entry = { key: keyFor(ADMIN), tenantId: TENANT, tags: analyticsCacheTags([ANALYTICS_ORG]), schema: valueSchema }
    const gate = deferred<{ value: number }>()
    const failing = jest.fn(() => gate.promise.then(() => { throw new Error('[internal] boom') }))
    const first = analytics.getOrCompute(entry, failing)
    const second = analytics.getOrCompute(entry, failing)
    gate.resolve({ value: 0 })
    await expect(first).rejects.toThrow('[internal] boom')
    await expect(second).rejects.toThrow('[internal] boom')
    expect(failing).toHaveBeenCalledTimes(1)
    expect(await analytics.getOrCompute(entry, async () => ({ value: 5 }))).toEqual({ value: 5 })
  })

  it('degrades to live computation when the cache fails or holds an invalid value, and works without a cache', async () => {
    const broken: CacheStrategy = {
      get: async () => { throw new Error('[internal] cache down') },
      set: async () => { throw new Error('[internal] cache down') },
      has: async () => false,
      delete: async () => false,
      deleteByTags: async () => { throw new Error('[internal] cache down') },
      clear: async () => 0,
      keys: async () => [],
      stats: async () => ({ size: 0, expired: 0 }),
    }
    const entry = { key: keyFor(ADMIN), tenantId: TENANT, tags: analyticsCacheTags([ANALYTICS_ORG]), schema: valueSchema }
    const degraded = createAnalyticsCache(broken, createAnalyticsCacheState())
    expect(await degraded.getOrCompute(entry, async () => ({ value: 4 }))).toEqual({ value: 4 })
    await expect(degraded.invalidate(TENANT, [ANALYTICS_ORG])).resolves.toBeUndefined()
    const memory = createCacheService({ strategy: 'memory' })
    await runWithCacheTenant(TENANT, () => memory.set(entry.key, { value: 'not a number' }))
    const corrupted = createAnalyticsCache(memory, createAnalyticsCacheState())
    expect(await corrupted.getOrCompute(entry, async () => ({ value: 6 }))).toEqual({ value: 6 })
    const none = createAnalyticsCache(null, createAnalyticsCacheState())
    expect(await none.getOrCompute(entry, async () => ({ value: 8 }))).toEqual({ value: 8 })
  })
})
