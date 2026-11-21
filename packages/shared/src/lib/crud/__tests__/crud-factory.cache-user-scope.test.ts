// Regression coverage for the CRUD list cache key missing a caller-identity
// segment: two callers in the same tenant/org scope requesting the identical
// URL must NOT share cache entries, because list payloads can vary per caller —
// buildFilters may narrow by ctx.auth (e.g. ?mine=true on staff time-projects,
// the isSuperAdmin branch on scheduler jobs), before-interceptor query rewrites
// are feature-gated per user, and afterList/after-interceptor output is
// embedded in the stored payload.

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, fn: () => Promise<unknown>) => fn(),
}), { virtual: true })

import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { z } from 'zod'

const defaultOrganizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const defaultTenantId = '123e4567-e89b-12d3-a456-426614174000'

let mockAuthSub = 'user-a'
let mockAuthKeyId: string | null = null
let mockOrganizationScope = {
  selectedId: defaultOrganizationId,
  filterIds: [defaultOrganizationId] as string[] | null,
  allowedIds: [defaultOrganizationId] as string[] | null,
  tenantId: defaultTenantId,
}

const em = {}

// Returns rows derived from the per-caller filter buildFilters produced, so a
// cross-user cache hit is observable as one user's rows in another's response.
const queryEngine = {
  query: jest.fn(async (_entity: string, opts: Record<string, any>) => {
    const owner = opts?.filters?.owner_user_id?.$eq ?? 'unfiltered'
    return {
      items: [{ id: `todo-of-${owner}`, title: `Owned by ${owner}`, organization_id: defaultOrganizationId, tenant_id: defaultTenantId }],
      total: 1,
    }
  }),
}

const store = new Map<string, unknown>()
const cache = {
  get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
  set: jest.fn(async (key: string, value: unknown) => { store.set(key, value) }),
  delete: jest.fn(async (key: string) => { store.delete(key) }),
  deleteByTags: jest.fn(async () => 0),
}

const accessLogService = { log: jest.fn(async () => {}) }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => ({
      em,
      queryEngine,
      cache,
      accessLogService,
    } as any)[name],
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => {
  const buildAuth = () => ({
    sub: mockAuthSub,
    keyId: mockAuthKeyId ?? undefined,
    orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenantId: '123e4567-e89b-12d3-a456-426614174000',
    roles: ['admin'],
  })
  return {
    getAuthFromCookies: async () => buildAuth(),
    getAuthFromRequest: async () => buildAuth(),
  }
})

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => mockOrganizationScope),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => {}),
}))

class Todo {}

const querySchema = z.object({
  id: z.string().optional(),
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
    buildFilters: (_query: any, ctx: any) => ({ owner_user_id: { $eq: ctx.auth?.sub ?? null } } as any),
    transformItem: (i: any) => ({ id: i.id, title: i.title }),
  },
})

const scopeIdentityRoute = makeCrudRoute({
  metadata: { GET: { requireAuth: true } },
  orm: { entity: Todo, idField: 'id', orgField: null, tenantField: null, softDeleteField: null },
  indexer: { entityType: 'example.cache_identity' },
  list: {
    schema: querySchema,
    disableListCacheForQuery: (query) => Boolean(query.id),
    entityId: 'example.cache_identity',
    fields: ['id', 'title'],
    sortFieldMap: { id: 'id', title: 'title' },
    buildFilters: () => ({} as any),
    transformItem: (item: any) => ({ id: item.id, title: item.title }),
  },
})

const url = 'http://x/api/example/todos?page=1&pageSize=10&sortField=id&sortDir=asc'

describe('CRUD Factory — list cache is partitioned per caller identity', () => {
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
    mockAuthSub = 'user-a'
    mockAuthKeyId = null
    mockOrganizationScope = {
      selectedId: defaultOrganizationId,
      filterIds: [defaultOrganizationId],
      allowedIds: [defaultOrganizationId],
      tenantId: defaultTenantId,
    }
    registerApiInterceptors([])
  })

  it('caches per user and still serves same-user repeat requests from cache', async () => {
    const first = await route.GET(new Request(url))
    expect(first.status).toBe(200)
    expect(first.headers.get('x-om-cache')).toBe('miss')
    expect((await first.json()).items[0].id).toBe('todo-of-user-a')

    const second = await route.GET(new Request(url))
    expect(second.headers.get('x-om-cache')).toBe('hit')
    expect((await second.json()).items[0].id).toBe('todo-of-user-a')
    expect(queryEngine.query).toHaveBeenCalledTimes(1)
  })

  it('bypasses cache reads and writes for private detail projections without disabling grid caching', async () => {
    const detailUrl = url + '&id=todo-of-user-a'
    const first = await scopeIdentityRoute.GET(new Request(detailUrl))
    const second = await scopeIdentityRoute.GET(new Request(detailUrl))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()

    await scopeIdentityRoute.GET(new Request(url))
    const gridHit = await scopeIdentityRoute.GET(new Request(url))
    expect(gridHit.headers.get('x-om-cache')).toBe('hit')
    expect(cache.set).toHaveBeenCalledTimes(1)
  })

  it('does not serve one user\'s cached rows to another user on the identical URL', async () => {
    mockAuthSub = 'user-a'
    const aRes = await route.GET(new Request(url))
    expect((await aRes.json()).items[0].id).toBe('todo-of-user-a')
    expect(store.size).toBe(1)

    mockAuthSub = 'user-b'
    const bRes = await route.GET(new Request(url))
    expect(bRes.headers.get('x-om-cache')).toBe('miss')
    expect((await bRes.json()).items[0].id).toBe('todo-of-user-b')
    expect(store.size).toBe(2)

    mockAuthSub = 'user-a'
    const aAgain = await route.GET(new Request(url))
    expect(aAgain.headers.get('x-om-cache')).toBe('hit')
    expect((await aAgain.json()).items[0].id).toBe('todo-of-user-a')
  })

  it('keys every entry with an identity segment, preferring the API key id over the user id', async () => {
    await route.GET(new Request(url))
    const userKey = Array.from(store.keys())[0] as string
    expect(userKey).toContain('user:user-a')

    store.clear()
    mockAuthKeyId = 'api-key-9'
    await route.GET(new Request(url))
    const apiKeyKey = Array.from(store.keys())[0] as string
    expect(apiKeyKey).toContain('user:api-key-9')
  })

  it.each([
    'filter[conditions][0][field]=owner_user_id&filter[conditions][0][op]=is&filter[conditions][0][value]=user-b',
    'filter[v]=2&filter[root][combinator]=and&filter[root][children][0][type]=rule&filter[root][children][0][field]=owner_user_id&filter[root][children][0][op]=is&filter[root][children][0][value]=user-b',
  ])('ignores persisted pre-intersection cache entries after upgrading: %s', async (filterQuery) => {
    const requestUrl = `${url}&${filterQuery}`
    const params = new URL(requestUrl).searchParams
    const serializedQuery = JSON.stringify(
      Array.from(params.entries())
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, value]) => [key, [value]]),
    )
    const legacyKey = [
      'crud', 'todo', 'GET', '/api/example/todos',
      `tenant:${defaultTenantId}`, `selectedOrg:${defaultOrganizationId}`,
      `scope:${defaultOrganizationId}`, 'user:user-a', `query:${serializedQuery}`,
    ].join('|')
    store.set(legacyKey, { payload: { items: [{ id: 'legacy-escaped-row' }], total: 1 }, generatedAt: Date.now() })

    const first = await route.GET(new Request(requestUrl))
    expect(first.status).toBe(200)
    expect(first.headers.get('x-om-cache')).toBe('miss')
    expect((await first.json()).items).not.toContainEqual({ id: 'legacy-escaped-row' })
    expect(queryEngine.query).toHaveBeenCalledTimes(1)
    expect(cache.get).not.toHaveBeenCalledWith(legacyKey)

    const repeat = await route.GET(new Request(requestUrl))
    expect(repeat.headers.get('x-om-cache')).toBe('hit')
    expect(queryEngine.query).toHaveBeenCalledTimes(1)
    expect(store.has(legacyKey)).toBe(true)
  })

  it('encodes explicit empty and finite scopes as different cache keys', async () => {
    await scopeIdentityRoute.GET(new Request(url))
    const finiteKey = Array.from(store.keys())[0] as string

    mockOrganizationScope = {
      selectedId: defaultOrganizationId,
      filterIds: [],
      allowedIds: [defaultOrganizationId],
      tenantId: defaultTenantId,
    }
    const emptyResponse = await scopeIdentityRoute.GET(new Request(url))
    const keys = Array.from(store.keys())

    expect(emptyResponse.headers.get('x-om-cache')).toBe('miss')
    expect(keys).toHaveLength(2)
    expect(finiteKey).toContain(`scope:${defaultOrganizationId}`)
    expect(keys[1]).toContain('scope:empty')
    expect(keys[1]).not.toBe(finiteKey)
    expect(queryEngine.query).toHaveBeenCalledTimes(2)
  })
})
