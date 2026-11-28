/** @jest-environment node */
// Component integration: production CRUD/cache code + real Redis; auth, DI and query DB are mocked.
import { createHash, randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { z } from 'zod'
import { createCacheService, runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { collectCrudCacheStats, purgeCrudCacheSegment } from '@open-mercato/shared/lib/crud/cache-stats'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'

const redisUrl = process.env.CACHE_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip
const resource = 'redisregression.lot'
type Actor = { sub: string; orgId: string; tenantId: string }
type Lot = { id: string; title: string; storage: string }
let mockActor: Actor
let mockRevision = 0
let mockCache: CacheStrategy
const queryEngine = { query: jest.fn(async () => ({ items: [{ ...lot(), organization_id: mockActor.orgId, tenant_id: mockActor.tenantId }], total: 1 })) }
const accessLogService = { log: jest.fn(async () => {}) }
const container = { resolve: (name: string): unknown => ({ em: {}, queryEngine, cache: mockCache, accessLogService } as Record<string, unknown>)[name] }

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => container }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: async () => ({ ...mockActor, roles: ['admin'] }),
  getAuthFromRequest: async () => ({ ...mockActor, roles: ['admin'] }),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({ selectedId: mockActor.orgId, filterIds: [mockActor.orgId], allowedIds: [mockActor.orgId], tenantId: mockActor.tenantId }),
}))
jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({ setRecordCustomFields: jest.fn(async () => {}) }))

function lot(): Lot {
  return { id: mockActor.orgId, title: `Frozen vegetable QC ${mockRevision}: ${mockActor.sub}/${mockActor.orgId}/${mockActor.tenantId}`,
    storage: 'Agram frozen peas, local growers, quality control; keep at -18°C. '.repeat(80) }
}
class FrozenLot {}
const route = makeCrudRoute({
  metadata: { GET: { requireAuth: true } },
  orm: { entity: FrozenLot, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  events: { module: 'redisregression', entity: 'lot' },
  indexer: { entityType: 'redisregression:lot' },
  list: {
    schema: z.object({ page: z.coerce.number().default(1), pageSize: z.coerce.number().default(10) }),
    entityId: 'redisregression:lot', fields: ['id', 'title', 'storage'],
    transformItem: (item: Lot) => ({ id: item.id, title: item.title, storage: item.storage }),
  },
})
const url = 'http://fixture.invalid/api/redisregression/lots?page=1&pageSize=10'
async function read(expected: 'miss' | 'hit', target = url): Promise<{ items: Lot[] }> {
  // The app's request boundary owns tenant context; makeCrudRoute consumes it.
  const response = await runWithCacheTenant(mockActor.tenantId, () => route.GET(new Request(target)))
  expect(response.status).toBe(200)
  expect(response.headers.get('x-om-cache')).toBe(expected)
  return response.json()
}
const scoped = <T>(actor: Actor, run: () => Promise<T>) => runWithCacheTenant(actor.tenantId, run)
async function invalidate(actor: Actor) {
  await invalidateCrudCache(container as never, resource, { id: actor.orgId, organizationId: actor.orgId, tenantId: actor.tenantId }, actor.tenantId, 'redis-live-test')
}

// Require an explicit test DB. Each fixture owns fresh tenant namespaces;
// cleanup never uses FLUSHDB/FLUSHALL or removes another tenant's keys.
async function fixture(compression: 'off' | 'gzip', run: (actors: Actor[], admin: Redis) => Promise<void>) {
  const parsed = new URL(redisUrl!)
  expect(['redis:', 'rediss:']).toContain(parsed.protocol)
  expect(parsed.pathname).toMatch(/^\/\d+$/)
  expect(parsed.search).toBe('')
  const tenants = [randomUUID(), randomUUID()], orgs = [randomUUID(), randomUUID()]
  const actors = [
    { sub: 'user-a', orgId: orgs[0], tenantId: tenants[0] },
    { sub: 'user-b', orgId: orgs[0], tenantId: tenants[0] },
    { sub: 'user-a', orgId: orgs[1], tenantId: tenants[0] },
    { sub: 'user-a', orgId: orgs[0], tenantId: tenants[1] },
  ]
  mockActor = actors[0]; mockRevision = 0
  queryEngine.query.mockClear(); accessLogService.log.mockClear(); registerApiInterceptors([])
  mockCache = createCacheService({ strategy: 'redis', redisUrl, compression, defaultTtl: 60_000 })
  const admin = new Redis(redisUrl!, { protocol: 2, maxRetriesPerRequest: 1 })
  try {
    expect(mockCache.healthcheck).toEqual(expect.any(Function))
    await mockCache.healthcheck!()
    // A raw physical read in every fixture catches dependency fallback and missing tenant wrapping.
    const proof = `proof:${randomUUID()}`
    await scoped(actors[0], () => mockCache.set(proof, { physical: true }, { ttl: 60_000 }))
    const digest = createHash('sha256').update(proof).digest('hex')
    expect(await admin.exists(`cache:tenant:${tenants[0]}:key:k:${digest}`)).toBe(1)
    expect(await scoped(actors[0], () => mockCache.delete(proof))).toBe(true)
    await run(actors, admin)
  } finally {
    // Collect our tenant namespaces first so deleting pages does not perturb SCAN iteration.
    try {
      for (const tenant of tenants) {
        const keys = new Set<string>(); let cursor = '0'
        do {
          const [next, page] = await admin.scan(cursor, 'MATCH', `*tenant:${tenant}:*`, 'COUNT', 256)
          cursor = next; for (const key of page) keys.add(key)
        } while (cursor !== '0')
        const ownKeys = [...keys]
        for (let offset = 0; offset < ownKeys.length; offset += 256) await admin.del(...ownKeys.slice(offset, offset + 256))
      }
    } finally { await Promise.all([admin.quit(), mockCache.close?.()]) }
  }
}

describeWithRedis.each(['off', 'gzip'] as const)('CRUD factory with live Redis (%s)', compression => {
  const previousFlag = process.env.ENABLE_CRUD_API_CACHE
  beforeAll(() => { process.env.ENABLE_CRUD_API_CACHE = 'true' })
  afterAll(() => {
    if (previousFlag === undefined) delete process.env.ENABLE_CRUD_API_CACHE
    else process.env.ENABLE_CRUD_API_CACHE = previousFlag
  })

  it('round-trips miss -> hit -> real tag invalidation -> fresh miss', async () => fixture(compression, async ([actor], admin) => {
    const expected = lot()
    expect((await read('miss')).items).toEqual([expected])
    expect((await read('hit')).items).toEqual([expected])
    expect(queryEngine.query).toHaveBeenCalledTimes(1)
    const [key] = await scoped(actor, () => mockCache.keys('crud|*'))
    expect(key).toBeDefined()
    const digest = createHash('sha256').update(key).digest('hex')
    const stored = await admin.getBuffer(`cache:tenant:${actor.tenantId}:key:k:${digest}`)
    expect(stored).not.toBeNull()
    if (compression === 'gzip') expect(stored!.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]))
    else expect(JSON.parse(stored!.toString('utf8')).value.payload.items).toEqual([expected])
    mockRevision = 1
    await invalidate(actor)
    expect(await scoped(actor, () => mockCache.keys('crud|*'))).toEqual([])
    const fresh = lot()
    expect((await read('miss')).items).toEqual([fresh])
    expect((await read('hit')).items).toEqual([fresh])
    expect(queryEngine.query).toHaveBeenCalledTimes(2)
  }))

  it('isolates users, organizations and tenants, including scoped invalidation', async () => fixture(compression, async actors => {
    const stored = []
    for (const actor of actors) {
      mockActor = actor; const expected = lot(); stored.push(expected)
      expect((await read('miss')).items).toEqual([expected])
      expect((await read('hit')).items).toEqual([expected])
    }
    expect(queryEngine.query).toHaveBeenCalledTimes(4)
    mockRevision = 1
    await invalidate(actors[0])
    for (const index of [2, 3]) {
      mockActor = actors[index]
      expect((await read('hit')).items).toEqual([stored[index]])
    }
    for (const index of [0, 1]) {
      mockActor = actors[index]
      expect((await read('miss')).items).toEqual([lot()])
    }
    expect(queryEngine.query).toHaveBeenCalledTimes(6)
  }))

  it('exposes logical keys/stats and purges one real CRUD segment', async () => fixture(compression, async actors => {
    const otherUrl = url.replace('/lots?', '/growers?')
    await read('miss'); await read('miss', otherUrl)
    const keys = await scoped(actors[0], () => mockCache.keys('crud|*'))
    expect(keys).toHaveLength(2); expect(new Set(keys).size).toBe(2)
    expect(keys.every(key => key.startsWith(`crud|${resource}|`))).toBe(true)
    expect(await scoped(actors[0], () => mockCache.stats())).toEqual({ size: 2, expired: 0 })
    const stats = await scoped(actors[0], () => collectCrudCacheStats(mockCache))
    expect(stats.totalKeys).toBe(2)
    expect(stats.segments).toHaveLength(2)
    expect(stats.segments.flatMap(segment => segment.keys).sort()).toEqual([...keys].sort())
    const segment = stats.segments.find(item => item.path?.includes('/lots'))
    expect(segment).toBeDefined()
    mockActor = actors[3]; const otherTenantPayload = (await read('miss')).items
    const purged = await scoped(actors[0], () => purgeCrudCacheSegment(mockCache, segment!.segment))
    expect(purged.deleted).toBe(1); expect(purged.keys).toEqual(segment!.keys)
    expect((await read('hit')).items).toEqual(otherTenantPayload)
    mockActor = actors[0]
    expect(await scoped(actors[0], () => mockCache.keys('crud|*'))).toHaveLength(1)
    await read('hit', otherUrl); await read('miss')
    expect(queryEngine.query).toHaveBeenCalledTimes(4)
  }))

  it('clears only the selected tenant and keeps another tenant cached', async () => fixture(compression, async actors => {
    await read('miss'); await read('miss', url.replace('/lots?', '/growers?'))
    mockActor = actors[3]; const otherTenantPayload = (await read('miss')).items
    expect(await scoped(actors[0], () => mockCache.clear())).toBe(2)
    expect(await scoped(actors[0], () => mockCache.keys())).toEqual([])
    expect(await scoped(actors[0], () => mockCache.stats())).toEqual({ size: 0, expired: 0 })
    expect((await read('hit')).items).toEqual(otherTenantPayload)
    mockActor = actors[0]; await read('miss')
    expect(queryEngine.query).toHaveBeenCalledTimes(4)
  }))
})
