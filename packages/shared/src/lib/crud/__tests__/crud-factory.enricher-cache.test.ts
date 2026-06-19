// Regression coverage for #2222: a CRUD list cache hit may skip re-running
// response enrichers ONLY when every active enricher opts into
// `cacheableOnListHit` (its output is a pure function of the cached record). For
// such enrichers the stored payload embeds enricher output and the cache key is
// partitioned by the active-enricher signature, so a hit serves the cached
// enrichment directly — eliminating the ~15ms per-hit cost — while staying
// ACL-gated. Enrichers that read live cross-module / time-dependent data (the
// default, fail-closed) MUST re-run on every hit, and the cache stores their
// pre-enrichment base payload — see the fail-closed test at the bottom.

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, fn: () => Promise<unknown>) => fn(),
}), { virtual: true })

import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { registerResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-registry'
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { z } from 'zod'

const defaultOrganizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const defaultTenantId = '123e4567-e89b-12d3-a456-426614174000'

let mockUserFeatures: string[] | undefined

const em = {}

const queryEngine = {
  query: jest.fn(async () => ({
    items: [{ id: 'id-1', title: 'A', organization_id: defaultOrganizationId, tenant_id: defaultTenantId }],
    total: 1,
  })),
}

// Simple Map-backed CRUD cache supporting the surface the factory touches.
const store = new Map<string, unknown>()
const cache = {
  get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
  set: jest.fn(async (key: string, value: unknown) => { store.set(key, value) }),
  delete: jest.fn(async (key: string) => { store.delete(key) }),
  deleteByTags: jest.fn(async () => 0),
}

const accessLogService = { log: jest.fn(async () => {}) }

const rbacService = {
  getGrantedFeatures: jest.fn(async () => mockUserFeatures),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => ({
      em,
      queryEngine,
      cache,
      accessLogService,
      rbacService,
    } as any)[name],
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => {
  const auth = {
    sub: 'u1',
    orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenantId: '123e4567-e89b-12d3-a456-426614174000',
    roles: ['admin'],
  }
  return {
    getAuthFromCookies: async () => auth,
    getAuthFromRequest: async () => auth,
  }
})

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    filterIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    allowedIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    tenantId: '123e4567-e89b-12d3-a456-426614174000',
  })),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => {}),
}))

class Todo {}

const enrichManyCalls = jest.fn()

// Record-pure enricher: its output depends only on the cached record, so it
// opts into `cacheableOnListHit` and is safe to embed in the list cache.
const gatedEnricher: ResponseEnricher<any> = {
  id: 'example.todo-flag',
  targetEntity: 'example.todo',
  features: ['example.view'],
  priority: 10,
  timeout: 2000,
  critical: false,
  cacheableOnListHit: true,
  fallback: { _example: { flagged: false } },
  async enrichOne(record, context) {
    return (await this.enrichMany!([record], context))[0]
  },
  async enrichMany(records) {
    enrichManyCalls()
    return records.map((record) => ({ ...record, _example: { flagged: true } }))
  },
}

// Live enricher: its output mirrors mutable external state (a stand-in for a
// cross-module read like the catalog product image in TC-SALES-023). It does NOT
// set `cacheableOnListHit`, so it must re-run on every cache hit.
const liveEnricherCalls = jest.fn()
let liveExternalValue = 'v1'

const liveEnricher: ResponseEnricher<any> = {
  id: 'example.todo-live',
  targetEntity: 'example.todo',
  features: [],
  priority: 5,
  timeout: 2000,
  critical: false,
  async enrichOne(record, context) {
    return (await this.enrichMany!([record], context))[0]
  },
  async enrichMany(records) {
    liveEnricherCalls()
    return records.map((record) => ({ ...record, _live: { value: liveExternalValue } }))
  },
}

const querySchema = z.object({
  page: z.coerce.number().default(1),
  pageSize: z.coerce.number().default(50),
  sortField: z.string().default('id'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
})

const route = makeCrudRoute({
  metadata: { GET: { requireAuth: true } },
  orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: 'example.todo' },
  list: {
    schema: querySchema,
    entityId: 'example.todo',
    fields: ['id', 'title'],
    sortFieldMap: { id: 'id', title: 'title' },
    buildFilters: () => ({} as any),
    transformItem: (i: any) => ({ id: i.id, title: i.title }),
  },
  enrichers: { entityId: 'example.todo' },
})

const url = 'http://x/api/example/todos?page=1&pageSize=10&sortField=id&sortDir=asc'

describe('CRUD Factory — response enrichers + list cache (#2222)', () => {
  const previousCacheFlag = process.env.ENABLE_CRUD_API_CACHE

  beforeAll(() => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
  })

  afterAll(() => {
    if (previousCacheFlag === undefined) delete process.env.ENABLE_CRUD_API_CACHE
    else process.env.ENABLE_CRUD_API_CACHE = previousCacheFlag
  })

  beforeEach(() => {
    jest.clearAllMocks()
    store.clear()
    mockUserFeatures = ['example.view']
    registerApiInterceptors([])
    registerResponseEnrichers([{ moduleId: 'example', enrichers: [gatedEnricher] }])
  })

  it('runs enrichers on the cache miss and caches the enriched payload', async () => {
    const res = await route.GET(new Request(url))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items[0]._example).toEqual({ flagged: true })
    expect(enrichManyCalls).toHaveBeenCalledTimes(1)
    expect(res.headers.get('x-om-cache')).toBe('miss')

    // The stored payload embeds the enrichment.
    const stored = Array.from(store.values())[0] as any
    expect(stored.payload.items[0]._example).toEqual({ flagged: true })
  })

  it('serves enriched fields from cache WITHOUT re-running enrichers on a hit', async () => {
    const first = await route.GET(new Request(url))
    expect(first.headers.get('x-om-cache')).toBe('miss')
    expect(enrichManyCalls).toHaveBeenCalledTimes(1)

    const second = await route.GET(new Request(url))
    const body = await second.json()
    expect(second.headers.get('x-om-cache')).toBe('hit')
    // Enriched output still present...
    expect(body.items[0]._example).toEqual({ flagged: true })
    // ...but the enricher did NOT run a second time.
    expect(enrichManyCalls).toHaveBeenCalledTimes(1)
  })

  it('partitions the cache by active-enricher signature so feature cohorts cannot leak ACL-gated fields', async () => {
    // Cohort A holds the gating feature → enricher active, enriched payload cached.
    mockUserFeatures = ['example.view']
    const aRes = await route.GET(new Request(url))
    const aBody = await aRes.json()
    expect(aBody.items[0]._example).toEqual({ flagged: true })
    const keysAfterA = new Set(store.keys())
    expect(keysAfterA.size).toBe(1)

    // Cohort B lacks the gating feature → enricher inactive (different signature →
    // different cache key) → must NOT receive cohort A's enriched fields.
    mockUserFeatures = []
    const bRes = await route.GET(new Request(url))
    const bBody = await bRes.json()
    expect(bBody.items[0]._example).toBeUndefined()
    expect(bRes.headers.get('x-om-cache')).toBe('miss')
    // A distinct entry was written for cohort B rather than reusing cohort A's.
    expect(store.size).toBe(2)

    // Cohort A still gets a fast, correct hit from its own entry.
    mockUserFeatures = ['example.view']
    const aAgain = await route.GET(new Request(url))
    const aAgainBody = await aAgain.json()
    expect(aAgain.headers.get('x-om-cache')).toBe('hit')
    expect(aAgainBody.items[0]._example).toEqual({ flagged: true })
  })
})

describe('CRUD Factory — fail-closed enrichers re-run on cache hits (#2222)', () => {
  const previousCacheFlag = process.env.ENABLE_CRUD_API_CACHE

  beforeAll(() => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
  })

  afterAll(() => {
    if (previousCacheFlag === undefined) delete process.env.ENABLE_CRUD_API_CACHE
    else process.env.ENABLE_CRUD_API_CACHE = previousCacheFlag
  })

  beforeEach(() => {
    jest.clearAllMocks()
    store.clear()
    liveExternalValue = 'v1'
    mockUserFeatures = ['example.view']
    registerApiInterceptors([])
    registerResponseEnrichers([{ moduleId: 'example', enrichers: [liveEnricher] }])
  })

  it('re-runs a non-cacheable enricher on a cache hit and reflects updated external data', async () => {
    const first = await route.GET(new Request(url))
    const firstBody = await first.json()
    expect(first.headers.get('x-om-cache')).toBe('miss')
    expect(firstBody.items[0]._live).toEqual({ value: 'v1' })
    expect(liveEnricherCalls).toHaveBeenCalledTimes(1)

    // External data the list cache does not invalidate on changes (e.g. a
    // catalog product image update for a sales line, as in TC-SALES-023).
    liveExternalValue = 'v2'

    const second = await route.GET(new Request(url))
    const secondBody = await second.json()
    expect(second.headers.get('x-om-cache')).toBe('hit')
    // The enricher re-ran on the hit, so the response reflects the new value...
    expect(secondBody.items[0]._live).toEqual({ value: 'v2' })
    expect(liveEnricherCalls).toHaveBeenCalledTimes(2)
  })

  it('caches the pre-enrichment base payload (no live enrichment embedded, no signature partition)', async () => {
    await route.GET(new Request(url))

    // Exactly one entry was written...
    expect(store.size).toBe(1)
    const [key, stored] = Array.from(store.entries())[0] as [string, any]
    // ...holding the base record without the live enrichment...
    expect(stored.payload.items[0]._live).toBeUndefined()
    // ...under a key that is NOT partitioned by an enricher signature.
    expect(key).not.toContain('enrichers:')
  })
})
