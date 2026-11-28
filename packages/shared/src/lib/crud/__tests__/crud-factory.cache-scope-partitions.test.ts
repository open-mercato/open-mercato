// Regression coverage for list-cache partitions the request URL cannot see:
// the resolved overlay locale (#7579), a route-owned `cacheScope` (#7529) and a
// before-interceptor query rewrite (#7529).

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, fn: () => Promise<unknown>) => fn(),
}), { virtual: true })

import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { registerTranslationOverlayPlugin } from '@open-mercato/shared/lib/localization/overlay-plugin'
import { invalidateTranslationOverlayCache } from '@open-mercato/shared/lib/crud/cache'
import { z } from 'zod'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantId = '123e4567-e89b-12d3-a456-426614174000'

const em = {}
const queryEngine = {
  query: jest.fn(async (_entity: string, opts: Record<string, any>) => {
    const scope = opts?.filters?.scope?.$eq ?? 'all'
    return {
      items: [{ id: `row-${scope}`, title: 'Base title', organization_id: organizationId, tenant_id: tenantId }],
      total: 1,
    }
  }),
}

const store = new Map<string, { value: unknown; tags: string[] }>()
const cache = {
  get: jest.fn(async (key: string) => (store.has(key) ? store.get(key)!.value : null)),
  set: jest.fn(async (key: string, value: unknown, options?: { tags?: string[] }) => {
    store.set(key, { value, tags: options?.tags ?? [] })
  }),
  delete: jest.fn(async (key: string) => { store.delete(key) }),
  deleteByTags: jest.fn(async (tags: string[]) => {
    let removed = 0
    for (const [key, entry] of store) {
      if (entry.tags.some((tag) => tags.includes(tag))) {
        store.delete(key)
        removed += 1
      }
    }
    return removed
  }),
}

const container = {
  resolve: (name: string) => ({ em, queryEngine, cache, accessLogService: { log: jest.fn(async () => {}) } } as Record<string, unknown>)[name],
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => container,
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => {
  const buildAuth = () => ({
    sub: 'user-a',
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

const querySchema = z.object({
  page: z.coerce.number().default(1),
  pageSize: z.coerce.number().default(50),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  scope: z.string().optional(),
  sectionDetail: z.literal('showcase').optional(),
}).passthrough()

let routeScope: string | null | undefined = undefined
const resolveRouteScope = jest.fn(() => routeScope)

const route = makeCrudRoute({
  metadata: { GET: { requireAuth: true } },
  orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: 'example.todo' },
  list: {
    schema: querySchema,
    entityId: 'example:todo',
    fields: ['id', 'title'],
    sortFieldMap: { id: 'id' },
    buildFilters: (query: z.infer<typeof querySchema>) => (query.scope ? { scope: { $eq: query.scope } } : {}),
    cacheScope: resolveRouteScope,
  },
  enrichers: { entityId: 'example:todo', detailRequest: (query) => query.sectionDetail === 'showcase' },
})

const listUrl = 'http://x/api/example/todos?page=1&pageSize=10'

async function readTitle(headers: Record<string, string> = {}): Promise<{ title: string; cache: string | null }> {
  const response = await route.GET(new Request(listUrl, { headers }))
  const body = await response.json() as { items: Array<{ title: string }> }
  return { title: body.items[0]?.title ?? '', cache: response.headers.get('x-om-cache') }
}

describe('CRUD list cache — partitions the URL cannot see', () => {
  const previousCacheFlag = process.env.ENABLE_CRUD_API_CACHE

  beforeAll(() => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
  })

  afterAll(() => {
    if (previousCacheFlag === undefined) delete process.env.ENABLE_CRUD_API_CACHE
    else process.env.ENABLE_CRUD_API_CACHE = previousCacheFlag
    registerTranslationOverlayPlugin(null, null)
  })

  beforeEach(() => {
    jest.clearAllMocks()
    store.clear()
    routeScope = undefined
    registerApiInterceptors([])
    registerTranslationOverlayPlugin(
      async (items, options) => items.map((item) => ({ ...item, title: `${options.locale}:title` })),
      (request) => request.headers.get('x-locale'),
    )
  })

  it('keeps one entry per resolved locale header (#7579)', async () => {
    expect((await readTitle({ 'x-locale': 'pl' })).title).toBe('pl:title')
    const german = await readTitle({ 'x-locale': 'de' })
    expect(german.title).toBe('de:title')
    expect(german.cache).not.toBe('hit')
    const polishAgain = await readTitle({ 'x-locale': 'pl' })
    expect(polishAgain.title).toBe('pl:title')
    expect(polishAgain.cache).toBe('hit')
    const unresolved = await readTitle()
    expect(unresolved.title).toBe('Base title')
    expect(unresolved.cache).not.toBe('hit')
  })

  it('drops localized entries when a translation of the entity changes (#7579)', async () => {
    await readTitle({ 'x-locale': 'pl' })
    expect(store.size).toBe(1)
    await invalidateTranslationOverlayCache(container as never, 'example:todo', tenantId)
    expect(store.size).toBe(0)
  })

  it('partitions by the route cacheScope and bypasses the cache on null (#7529)', async () => {
    routeScope = 'projects:a'
    await readTitle()
    routeScope = 'projects:a,b'
    expect((await readTitle()).cache).not.toBe('hit')
    routeScope = 'projects:a'
    expect((await readTitle()).cache).toBe('hit')
    const entriesBeforeBypass = store.size
    routeScope = null
    await readTitle()
    await readTitle()
    expect(store.size).toBe(entriesBeforeBypass)
    expect(cache.get).toHaveBeenCalledTimes(3)
  })

  it('bypasses list cache scope for fresh detail enrichment', async () => {
    routeScope = 'projects:a'
    await readTitle()
    jest.clearAllMocks()

    const response = await route.GET(new Request(`${listUrl}&sectionDetail=showcase`))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(queryEngine.query).toHaveBeenCalledTimes(1)
    expect(resolveRouteScope).not.toHaveBeenCalled()
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('partitions by a before-interceptor query rewrite (#7529)', async () => {
    let interceptorScope = 'first'
    registerApiInterceptors([{
      moduleId: 'app',
      interceptors: [{
        id: 'app.scope-todos',
        targetRoute: 'example/todos',
        methods: ['GET'],
        before: async (request) => ({ ok: true, query: { ...(request.query ?? {}), scope: interceptorScope } }),
      }],
    }])
    await route.GET(new Request(listUrl))
    interceptorScope = 'second'
    const response = await route.GET(new Request(listUrl))
    const body = await response.json() as { items: Array<{ id: string }> }
    expect(body.items[0]?.id).toBe('row-second')
  })
})
