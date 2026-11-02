// Regression coverage for tenant-level (orgField: null) makeCrudRoute lists:
// a create invalidates the tenant-level `org:null` collection tag (the record
// carries no organization), so the cached list MUST be tagged with that same
// tag — tagging it with the caller's organization scope left the entry
// unflushable and served a stale list until TTL.

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, fn: () => Promise<unknown>) => fn(),
}), { virtual: true })

import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { z } from 'zod'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantId = '123e4567-e89b-12d3-a456-426614174000'

let rows: Array<{ id: string; name: string }> = []

const queryEngine = {
  query: jest.fn(async () => ({ items: rows.map((row) => ({ ...row, tenant_id: tenantId })), total: rows.length })),
}

const store = new Map<string, { value: unknown; tags: string[] }>()
const cache = {
  get: jest.fn(async (key: string) => store.get(key)?.value ?? null),
  set: jest.fn(async (key: string, value: unknown, options?: { tags?: string[] }) => {
    store.set(key, { value, tags: options?.tags ?? [] })
  }),
  delete: jest.fn(async (key: string) => { store.delete(key) }),
  deleteByTags: jest.fn(async (tags: string[]) => {
    let removed = 0
    for (const [key, entry] of Array.from(store.entries())) {
      if (entry.tags.some((tag) => tags.includes(tag))) {
        store.delete(key)
        removed += 1
      }
    }
    return removed
  }),
}

const container = {
  resolve: (name: string) => ({
    em: {},
    queryEngine,
    cache,
    accessLogService: { log: jest.fn(async () => {}) },
  } as Record<string, unknown>)[name],
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

class TenantGroup {}

const querySchema = z.object({
  page: z.coerce.number().default(1),
  pageSize: z.coerce.number().default(50),
})

const route = makeCrudRoute({
  metadata: { GET: { requireAuth: true } },
  orm: { entity: TenantGroup, idField: 'id', orgField: null, tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  events: { module: 'example', entity: 'tenant_group' },
  indexer: { entityType: 'example:tenant_group' },
  list: {
    schema: querySchema,
    entityId: 'example:tenant_group',
    fields: ['id', 'name'],
    transformItem: (item: { id: string; name: string }) => ({ id: item.id, name: item.name }),
  },
})

const url = 'http://x/api/example/tenant-groups?page=1&pageSize=10'

describe('CRUD Factory — tenant-level (orgField: null) list cache invalidation', () => {
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
    rows = []
    registerApiInterceptors([])
  })

  it('tags the cached list with the tenant-level collection tag, not the caller org', async () => {
    await route.GET(new Request(url))
    const [entry] = Array.from(store.values())
    expect(entry.tags).toContain(`crud:example.tenant.group:tenant:${tenantId}:org:null:collection`)
    expect(entry.tags).not.toContain(`crud:example.tenant.group:tenant:${tenantId}:org:${organizationId}:collection`)
  })

  it('serves the new row after a create invalidates the tenant-level collection', async () => {
    const before = await route.GET(new Request(url))
    expect(before.headers.get('x-om-cache')).toBe('miss')
    expect((await before.json()).items).toEqual([])

    rows = [{ id: 'group-1', name: 'Wholesale' }]
    await invalidateCrudCache(
      container as never,
      'example.tenant.group',
      { id: 'group-1', organizationId: null, tenantId },
      tenantId,
      'created',
    )

    const after = await route.GET(new Request(url))
    expect(after.headers.get('x-om-cache')).toBe('miss')
    expect((await after.json()).items).toEqual([{ id: 'group-1', name: 'Wholesale' }])
  })
})
