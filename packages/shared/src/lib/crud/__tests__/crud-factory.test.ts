jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, fn: () => Promise<unknown>) => fn(),
}), { virtual: true })

import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import {
  clearOptimisticLockReadersForTests,
  getAllOptimisticLockReaders,
  registerOptimisticLockReaders,
} from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import { loadCustomFieldDefinitionIndex } from '@open-mercato/shared/lib/crud/custom-fields'
import { z } from 'zod'

// Keep the real custom-field helpers but spy on the definition loader so we can
// assert the factory skips the second DB round-trip when the query engine has
// already resolved definitions (issue #2133).
jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/custom-fields')
  return { ...actual, loadCustomFieldDefinitionIndex: jest.fn(async () => new Map()) }
})

// ---- Mocks ----
const mockEventBus = { emitEvent: jest.fn() }
const defaultOrganizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const defaultTenantId = '123e4567-e89b-12d3-a456-426614174000'
type MockOrganizationScope = {
  selectedId: string | null
  filterIds: string[] | null
  allowedIds: string[] | null
  tenantId: string | null
}

type Rec = { id: string; organizationId: string; tenantId: string; title?: string; isDone?: boolean; deletedAt?: Date | null }
let db: Record<string, Rec>
let idSeq = 1
let commandBus: { execute: jest.Mock }
let crudMutationGuardService: { validateMutation: jest.Mock; afterMutationSuccess: jest.Mock } | null
let mockOrganizationScopeOverride: MockOrganizationScope | null

const em = {
  transactional: async (cb: () => any) => {
    const snapshot = Object.fromEntries(Object.entries(db).map(([key, value]) => [key, { ...value }]))
    try {
      return await cb()
    } catch (error) {
      for (const key of Object.keys(db)) delete db[key]
      Object.assign(db, snapshot)
      throw error
    }
  },
  create: (_cls: any, data: any) => ({ ...data, id: `id-${idSeq++}` }),
  persist(entity: Rec) {
    db[entity.id] = { ...(db[entity.id] || {} as any), ...entity }
    return { flush: async () => undefined }
  },
  remove(entity: Rec) {
    delete db[entity.id]
    return { flush: async () => undefined }
  },
  findOne: async (_entity: any, where: any) => (em.getRepository(_entity).findOne(where) as any),
  getRepository: (_cls: any) => ({
    find: async (where: any) => Object.values(db).filter((r) => {
      const idClause = where.id
      const matchesId = !idClause
        ? true
        : (typeof idClause === 'string'
          ? r.id === idClause
          : (typeof idClause === 'object' && Array.isArray(idClause.$in))
            ? idClause.$in.includes(r.id)
            : (typeof idClause === 'object' && typeof idClause.$eq === 'string')
              ? r.id === idClause.$eq
              : true)
      const orgClause = where.organizationId
      const matchesOrg = !orgClause
        ? true
        : (typeof orgClause === 'object' && Array.isArray(orgClause.$in))
          ? orgClause.$in.includes(r.organizationId)
          : r.organizationId === orgClause
      const matchesTenant = !where.tenantId || r.tenantId === where.tenantId
      const matchesDeleted = where.deletedAt === null ? !r.deletedAt : true
      return matchesId && matchesOrg && matchesTenant && matchesDeleted
    }),
    findOne: async (where: any) => Object.values(db).find((r) => {
      if (r.id !== where.id) return false
      const orgClause = where.organizationId
      const matchesOrg = !orgClause
        ? true
        : (typeof orgClause === 'object' && Array.isArray(orgClause.$in))
          ? orgClause.$in.includes(r.organizationId)
          : r.organizationId === orgClause
      return matchesOrg && r.tenantId === where.tenantId
    }) || null,
    remove(entity: Rec) {
      delete db[entity.id]
      return { flush: async () => undefined }
    },
  }),
}

const queryEngine = {
  query: jest.fn(async (_entityId: any, _q: any) => ({ items: [{ id: 'id-1', title: 'A', is_done: false, organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenant_id: '123e4567-e89b-12d3-a456-426614174000' }], total: 1 })),
}

const mockDataEngine = {
  __pendingSideEffects: [] as any[],
  createOrmEntity: jest.fn(async ({ entity, data }: any) => {
    const created = em.create(entity, data)
    await em.persist(created as any).flush()
    return created
  }),
  updateOrmEntity: jest.fn(async ({ entity, where, apply }: any) => {
    const current = await (em.getRepository(entity).findOne(where) as any)
    if (!current) return null
    await apply(current)
    await em.persist(current).flush()
    return current
  }),
  deleteOrmEntity: jest.fn(async ({ entity, where, soft, softDeleteField }: any) => {
    const repo = em.getRepository(entity)
    const current = await (repo.findOne(where) as any)
    if (!current) return null
    if (soft !== false) { (current as any)[softDeleteField || 'deletedAt'] = new Date(); await em.persist(current).flush() }
    else await repo.remove(current).flush()
    return current
  }),
  setCustomFields: jest.fn(async (args: any) => {
    await (setRecordCustomFields as any)(em, args)
  }),
  emitOrmEntityEvent: jest.fn(async (_entry: any) => {}),
  markOrmEntityChange: jest.fn(function (this: any, entry: any) {
    if (!entry || !entry.entity) return
    this.__pendingSideEffects.push(entry)
  }),
  flushOrmEntityChanges: jest.fn(async function (this: any) {
    while (this.__pendingSideEffects.length > 0) {
      const next = this.__pendingSideEffects.shift()
      await this.emitOrmEntityEvent(next)
    }
  }),
}

const accessLogService = {
  log: jest.fn(async () => {}),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => ({
      em,
      queryEngine,
      eventBus: mockEventBus,
      dataEngine: mockDataEngine,
      accessLogService,
      commandBus,
      crudMutationGuardService,
    } as any)[name],
  })
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
  resolveOrganizationScopeForRequest: jest.fn(async () => mockOrganizationScopeOverride ?? ({
    selectedId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    filterIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    allowedIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    tenantId: '123e4567-e89b-12d3-a456-426614174000',
  })),
}))

const setRecordCustomFields = jest.fn(async () => {})
jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: (...args: any[]) => (setRecordCustomFields as any)(...args)
}))

// Fake entity class
class Todo {}

describe('CRUD Factory', () => {
  beforeEach(() => {
    db = {}
    idSeq = 1
    jest.clearAllMocks()
    accessLogService.log.mockClear()
    mockDataEngine.__pendingSideEffects = []
    mockOrganizationScopeOverride = null
    commandBus = {
      execute: jest.fn(async () => ({ result: {}, logEntry: { id: 'log-1' } })),
    }
    crudMutationGuardService = null
    registerApiInterceptors([])
  })

  const querySchema = z.object({
    page: z.coerce.number().default(1),
    pageSize: z.coerce.number().default(50),
    sortField: z.string().default('id'),
    sortDir: z.enum(['asc','desc']).default('asc'),
    format: z.enum(['csv', 'json', 'xml', 'markdown']).optional(),
  })
  const createSchema = z.object({ title: z.string().min(1), is_done: z.boolean().optional().default(false), cf_priority: z.number().optional() })
  const updateSchema = z.object({ id: z.string(), title: z.string().optional(), is_done: z.boolean().optional(), cf_priority: z.number().optional() })

  const route = makeCrudRoute({
    metadata: { GET: { requireAuth: true }, POST: { requireAuth: true }, PUT: { requireAuth: true }, DELETE: { requireAuth: true } },
    orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
    events: { module: 'example', entity: 'todo', persistent: true },
    indexer: { entityType: 'example.todo' },
    list: {
      schema: querySchema,
      entityId: 'example.todo',
      fields: ['id','title','is_done'],
      sortFieldMap: { id: 'id', title: 'title' },
      buildFilters: () => ({} as any),
      transformItem: (i: any) => ({ id: i.id, title: i.title, is_done: i.is_done }),
      allowCsv: true,
      csv: { headers: ['id','title','is_done'], row: (t) => [t.id, t.title, t.is_done ? '1' : '0'], filename: 'todos.csv' }
    },
    create: {
      schema: createSchema,
      mapToEntity: (input) => ({ title: (input as any).title, isDone: !!(input as any).is_done }),
      customFields: { enabled: true, entityId: 'example.todo', pickPrefixed: true },
    },
    update: {
      schema: updateSchema,
      applyToEntity: (e, input) => { if ((input as any).title !== undefined) (e as any).title = (input as any).title; if ((input as any).is_done !== undefined) (e as any).isDone = !!(input as any).is_done },
      customFields: { enabled: true, entityId: 'example.todo', pickPrefixed: true },
    },
    del: { idFrom: 'query', softDelete: true },
  })

  it('GET returns JSON list via QueryEngine', async () => {
    const res = await route.GET(new Request('http://x/api/example/todos?page=1&pageSize=10&sortField=id&sortDir=asc'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.length).toBe(1)
    expect(body.total).toBe(1)
    expect(body.items[0]).toEqual({ id: 'id-1', title: 'A', is_done: false })
    expect(accessLogService.log).toHaveBeenCalledTimes(1)
    expect(accessLogService.log).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'example.todo',
      resourceId: 'id-1',
      accessType: 'read',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      actorUserId: 'u1',
      fields: expect.arrayContaining(['id', 'title', 'is_done']),
      context: expect.objectContaining({
        resultCount: 1,
        accessType: 'read',
        queryKeys: expect.arrayContaining(['page', 'pageSize', 'sortField', 'sortDir']),
      }),
    }))
  })

  const makeDecoratedRoute = () => makeCrudRoute({
    metadata: { GET: { requireAuth: true } },
    orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
    indexer: { entityType: 'example.todo' },
    list: {
      schema: querySchema,
      entityId: 'example.todo',
      fields: ['id', 'title'],
      buildFilters: () => ({} as any),
      decorateCustomFields: { entityIds: 'example.todo' },
    },
  })

  const colorDefinitionIndex = () => new Map([
    ['color', [{ key: 'color', label: 'Color', kind: 'text', multi: false, dictionaryId: null, organizationId: null, tenantId: null, priority: 0, updatedAt: 0 }]],
  ])

  it('reuses query engine custom-field definitions and skips the second DB load (#2133)', async () => {
    const loadIndexMock = loadCustomFieldDefinitionIndex as unknown as jest.Mock
    const cfRoute = makeDecoratedRoute()
    queryEngine.query.mockResolvedValueOnce({
      items: [{ id: 'id-1', title: 'A', cf_color: 'blue', organization_id: defaultOrganizationId, tenant_id: defaultTenantId }],
      total: 1,
      customFieldDefinitions: {
        index: colorDefinitionIndex(),
        entityIds: ['example.todo'],
        tenantId: defaultTenantId,
        organizationIds: [defaultOrganizationId],
      },
    })

    const res = await cfRoute.GET(new Request('http://x/api/example/todos?page=1&pageSize=10&sortField=id&sortDir=asc'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(loadIndexMock).not.toHaveBeenCalled()
    expect(body.items[0].customValues).toEqual({ color: 'blue' })
  })

  it('falls back to loading definitions when the engine index does not cover the scope', async () => {
    const loadIndexMock = loadCustomFieldDefinitionIndex as unknown as jest.Mock
    loadIndexMock.mockResolvedValueOnce(colorDefinitionIndex())
    const cfRoute = makeDecoratedRoute()
    queryEngine.query.mockResolvedValueOnce({
      items: [{ id: 'id-1', title: 'A', cf_color: 'blue', organization_id: defaultOrganizationId, tenant_id: defaultTenantId }],
      total: 1,
      customFieldDefinitions: {
        index: new Map(),
        entityIds: ['example.todo'],
        tenantId: defaultTenantId,
        organizationIds: ['some-other-org'],
      },
    })

    const res = await cfRoute.GET(new Request('http://x/api/example/todos?page=1&pageSize=10&sortField=id&sortDir=asc'))
    expect(res.status).toBe(200)
    expect(loadIndexMock).toHaveBeenCalledTimes(1)
  })

  it('GET applies ids query filter in query engine path', async () => {
    const idA = '550e8400-e29b-41d4-a716-446655440001'
    const idB = '550e8400-e29b-41d4-a716-446655440002'
    await route.GET(new Request(`http://x/api/example/todos?page=1&pageSize=10&sortField=id&sortDir=asc&ids=${idA},${idB}`))

    expect(queryEngine.query).toHaveBeenCalled()
    const queryArgs = queryEngine.query.mock.calls.at(-1)?.[1]
    expect(queryArgs?.filters).toEqual({
      id: { $in: [idA, idB] },
    })
  })

  it('GET normalizes custom field sort selectors for the query engine path', async () => {
    await route.GET(new Request('http://x/api/example/todos?page=1&pageSize=10&sortField=cf_priority&sortDir=desc'))

    expect(queryEngine.query).toHaveBeenCalled()
    const queryArgs = queryEngine.query.mock.calls.at(-1)?.[1]
    expect(queryArgs?.sort).toEqual([
      { field: 'cf:priority', dir: 'desc' },
    ])
  })

  const optionalSortQuerySchema = z.object({
    page: z.coerce.number().default(1),
    pageSize: z.coerce.number().default(50),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })

  const makeDefaultSortRoute = () => makeCrudRoute({
    metadata: { GET: { requireAuth: true } },
    orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
    indexer: { entityType: 'example.todo' },
    list: {
      schema: optionalSortQuerySchema,
      entityId: 'example.todo',
      fields: ['id', 'title', 'created_at'],
      sortFieldMap: { id: 'id', title: 'title', createdAt: 'created_at' },
      defaultSort: { field: 'created_at', dir: 'desc' },
      buildFilters: () => ({} as any),
    },
  })

  it('GET applies list.defaultSort when the request has no sort params', async () => {
    const defaultSortRoute = makeDefaultSortRoute()
    await defaultSortRoute.GET(new Request('http://x/api/example/todos?page=1&pageSize=10'))

    expect(queryEngine.query).toHaveBeenCalled()
    const queryArgs = queryEngine.query.mock.calls.at(-1)?.[1]
    expect(queryArgs?.sort).toEqual([
      { field: 'created_at', dir: 'desc' },
    ])
  })

  it('GET keeps the id/asc default when no sort params and no defaultSort', async () => {
    await route.GET(new Request('http://x/api/example/todos?page=1&pageSize=10'))

    expect(queryEngine.query).toHaveBeenCalled()
    const queryArgs = queryEngine.query.mock.calls.at(-1)?.[1]
    expect(queryArgs?.sort).toEqual([
      { field: 'id', dir: 'asc' },
    ])
  })

  it('GET explicit sortField overrides list.defaultSort', async () => {
    const defaultSortRoute = makeDefaultSortRoute()
    await defaultSortRoute.GET(new Request('http://x/api/example/todos?page=1&pageSize=10&sortField=title&sortDir=asc'))

    expect(queryEngine.query).toHaveBeenCalled()
    const queryArgs = queryEngine.query.mock.calls.at(-1)?.[1]
    expect(queryArgs?.sort).toEqual([
      { field: 'title', dir: 'asc' },
    ])
  })

  it('GET intersects ids with existing buildFilters id constraint', async () => {
    const routeWithIdFilter = makeCrudRoute({
      metadata: { GET: { requireAuth: true } },
      orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
      indexer: { entityType: 'example.todo' },
      list: {
        schema: querySchema.extend({ id: z.string().optional() }),
        entityId: 'example.todo',
        fields: ['id', 'title'],
        buildFilters: (query) => query.id ? ({ id: { $eq: query.id } } as any) : ({} as any),
      },
    })
    const selected = '550e8400-e29b-41d4-a716-446655440001'
    const other = '550e8400-e29b-41d4-a716-446655440002'

    await routeWithIdFilter.GET(new Request(`http://x/api/example/todos?id=${selected}&ids=${selected},${other}`))
    const matchingArgs = queryEngine.query.mock.calls.at(-1)?.[1]
    expect(matchingArgs?.filters).toEqual({
      id: { $in: [selected] },
    })

    await routeWithIdFilter.GET(new Request(`http://x/api/example/todos?id=${selected}&ids=${other}`))
    const missingArgs = queryEngine.query.mock.calls.at(-1)?.[1]
    expect(missingArgs?.filters).toEqual({
      id: { $in: [] },
    })
  })

  it('GET applies ids query filter in ORM fallback path', async () => {
    const fallbackRoute = makeCrudRoute({
      metadata: { GET: { requireAuth: true } },
      orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
      list: {
        schema: querySchema,
        buildFilters: () => ({} as any),
      },
    })

    const first = em.create(Todo, { title: 'One', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId: '123e4567-e89b-12d3-a456-426614174000' }) as Rec
    first.id = '550e8400-e29b-41d4-a716-446655440010'
    await em.persist(first).flush()
    const second = em.create(Todo, { title: 'Two', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId: '123e4567-e89b-12d3-a456-426614174000' }) as Rec
    second.id = '550e8400-e29b-41d4-a716-446655440011'
    await em.persist(second).flush()

    const res = await fallbackRoute.GET(new Request(`http://x/api/example/todos?ids=${first.id}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.id).toBe(first.id)
  })

  it('GET ORM fallback keeps automatic tenant/org scoping by default', async () => {
    const fallbackRoute = makeCrudRoute({
      metadata: { GET: { requireAuth: true } },
      orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
      list: {
        schema: querySchema,
        buildFilters: () => ({} as any),
      },
    })

    const mine = em.create(Todo, { title: 'Mine', organizationId: defaultOrganizationId, tenantId: defaultTenantId }) as Rec
    mine.id = '550e8400-e29b-41d4-a716-446655440020'
    await em.persist(mine).flush()
    const other = em.create(Todo, { title: 'Other', organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenantId: defaultTenantId }) as Rec
    other.id = '550e8400-e29b-41d4-a716-446655440021'
    await em.persist(other).flush()

    const res = await fallbackRoute.GET(new Request('http://x/api/example/todos'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.items.map((i: any) => i.id)
    expect(ids).toContain(mine.id)
    expect(ids).not.toContain(other.id)
  })

  it('GET ORM fallback skips automatic scoping when omitAutomaticTenantOrgScope is set', async () => {
    const fallbackRoute = makeCrudRoute({
      metadata: { GET: { requireAuth: true } },
      orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
      list: {
        schema: querySchema,
        buildFilters: () => ({} as any),
        omitAutomaticTenantOrgScope: true,
      },
    })

    const mine = em.create(Todo, { title: 'Mine', organizationId: defaultOrganizationId, tenantId: defaultTenantId }) as Rec
    mine.id = '550e8400-e29b-41d4-a716-446655440030'
    await em.persist(mine).flush()
    const otherOrg = em.create(Todo, { title: 'OtherOrg', organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenantId: defaultTenantId }) as Rec
    otherOrg.id = '550e8400-e29b-41d4-a716-446655440031'
    await em.persist(otherOrg).flush()
    const otherTenant = em.create(Todo, { title: 'OtherTenant', organizationId: defaultOrganizationId, tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) as Rec
    otherTenant.id = '550e8400-e29b-41d4-a716-446655440032'
    await em.persist(otherTenant).flush()

    const res = await fallbackRoute.GET(new Request('http://x/api/example/todos'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.items.map((i: any) => i.id)
    // With the flag, buildFilters returns {} and auto-scope is suppressed —
    // so rows from other orgs/tenants are reachable. Callers are expected to
    // encode full visibility in buildFilters themselves.
    expect(ids).toContain(mine.id)
    expect(ids).toContain(otherOrg.id)
    expect(ids).toContain(otherTenant.id)
  })

  it('GET returns CSV when format=csv', async () => {
    const res = await route.GET(new Request('http://x/api/example/todos?page=1&pageSize=10&sortField=id&sortDir=asc&format=csv'))
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('todos.csv')
    const text = await res.text()
    expect(text.split('\n')[0]).toBe('id,title,is_done')
    expect(accessLogService.log).toHaveBeenCalledTimes(1)
  })

  it('GET returns JSON export when format=json', async () => {
    const res = await route.GET(new Request('http://x/api/example/todos?format=json'))
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('content-disposition')).toContain('todo.json')
    const text = await res.text()
    const parsed = JSON.parse(text)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0]).toEqual({ id: 'id-1', title: 'A', is_done: '0' })
  })

  it('GET returns XML export when format=xml', async () => {
    const res = await route.GET(new Request('http://x/api/example/todos?format=xml'))
    expect(res.headers.get('content-type')).toContain('application/xml')
    expect(res.headers.get('content-disposition')).toContain('todo.xml')
    const text = await res.text()
    expect(text).toContain('<records>')
    expect(text).toContain('<id>id-1</id>')
    expect(text).toContain('<title>A</title>')
  })

  it('GET returns Markdown export when format=markdown', async () => {
    const res = await route.GET(new Request('http://x/api/example/todos?format=markdown'))
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(res.headers.get('content-disposition')).toContain('todo.md')
    const text = await res.text()
    const lines = text.split('\n')
    expect(lines[0]).toBe('| id | title | is_done |')
    expect(lines[2]).toContain('id-1')
  })

  it('GET returns full export when exportScope=full', async () => {
    const res = await route.GET(new Request('http://x/api/example/todos?format=json&exportScope=full'))
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('content-disposition')).toContain('todo_full.json')
    const text = await res.text()
    const parsed = JSON.parse(text)
    expect(Array.isArray(parsed)).toBe(true)
    const row = parsed[0]
    expect(row).toMatchObject({
      Id: 'id-1',
      Title: 'A',
      'Is Done': false,
      'Organization Id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Tenant Id': '123e4567-e89b-12d3-a456-426614174000',
    })
  })

  it('POST creates entity, saves custom fields, emits created event', async () => {
    const res = await route.POST(new Request('http://x/api/example/todos', { method: 'POST', body: JSON.stringify({ title: 'B', is_done: true, cf_priority: 3 }), headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBeDefined()
    // CF saved
    expect(setRecordCustomFields).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityId: 'example.todo', values: { priority: 3 } }))
    // Event + indexer delegated to data engine
    expect(mockDataEngine.emitOrmEntityEvent).toHaveBeenCalledTimes(1)
    const createdCall = mockDataEngine.emitOrmEntityEvent.mock.calls.at(0)
    expect(createdCall).toBeDefined()
    const [createdArgs] = createdCall!
    expect(createdArgs.action).toBe('created')
    expect(createdArgs.identifiers.id).toBe(data.id)
    expect(createdArgs.events?.module).toBe('example')
    expect(createdArgs.events?.entity).toBe('todo')
    expect(createdArgs.indexer?.entityType).toBe('example.todo')
    // Entity in db
    const rec = db[data.id]
    expect(rec).toBeTruthy()
    expect(rec.title).toBe('B')
    expect(rec.isDone).toBe(true)
  })

  it('PUT updates entity, saves custom fields, emits updated event', async () => {
    // Seed
    const created = em.create(Todo, { title: 'X', organizationId: defaultOrganizationId, tenantId: defaultTenantId }) as Rec
    // Force UUID id to satisfy validation
    created.id = '123e4567-e89b-12d3-a456-426614174001'
    await em.persist(created).flush()
    const res = await route.PUT(new Request('http://x/api/example/todos', { method: 'PUT', body: JSON.stringify({ id: created.id, title: 'X2', cf_priority: 5 }), headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBe(200)
    expect(setRecordCustomFields).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ values: { priority: 5 } }))
    expect(mockDataEngine.emitOrmEntityEvent).toHaveBeenCalledTimes(1)
    const updatedCall = mockDataEngine.emitOrmEntityEvent.mock.calls.at(0)
    expect(updatedCall).toBeDefined()
    const [updatedArgs] = updatedCall!
    expect(updatedArgs.action).toBe('updated')
    expect(updatedArgs.identifiers.id).toBe(created.id)
    expect(updatedArgs.indexer?.entityType).toBe('example.todo')
    expect(db[created.id].title).toBe('X2')
  })

  it('POST rolls back the created entity when the custom field write fails', async () => {
    setRecordCustomFields.mockImplementationOnce(async () => { throw new Error('cf write failed') })
    const res = await route.POST(new Request('http://x/api/example/todos', { method: 'POST', body: JSON.stringify({ title: 'Atomic', is_done: true, cf_priority: 3 }), headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBe(500)
    // Entity write was rolled back together with the failed custom field write
    expect(Object.values(db)).toHaveLength(0)
    // No created event/index is emitted for a rolled-back create
    expect(mockDataEngine.emitOrmEntityEvent).not.toHaveBeenCalled()
  })

  it('PUT rolls back the entity update when the custom field write fails', async () => {
    const created = em.create(Todo, { title: 'Before', organizationId: defaultOrganizationId, tenantId: defaultTenantId }) as Rec
    created.id = '123e4567-e89b-12d3-a456-426614174003'
    await em.persist(created).flush()
    setRecordCustomFields.mockImplementationOnce(async () => { throw new Error('cf write failed') })
    const res = await route.PUT(new Request('http://x/api/example/todos', { method: 'PUT', body: JSON.stringify({ id: created.id, title: 'After', cf_priority: 5 }), headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBe(500)
    // The scalar update was rolled back together with the failed custom field write
    expect(db[created.id].title).toBe('Before')
    expect(mockDataEngine.emitOrmEntityEvent).not.toHaveBeenCalled()
  })

  it('DELETE soft-deletes entity and emits deleted event', async () => {
    const created = em.create(Todo, { title: 'Y', organizationId: defaultOrganizationId, tenantId: defaultTenantId }) as Rec
    created.id = '123e4567-e89b-12d3-a456-426614174002'
    await em.persist(created).flush()
    const res = await route.DELETE(new Request(`http://x/api/example/todos?id=${created.id}`, { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(mockDataEngine.emitOrmEntityEvent).toHaveBeenCalledTimes(1)
    const deletedCall = mockDataEngine.emitOrmEntityEvent.mock.calls.at(0)
    expect(deletedCall).toBeDefined()
    const [deletedArgs] = deletedCall!
    expect(deletedArgs.action).toBe('deleted')
    expect(deletedArgs.identifiers.id).toBe(created.id)
    expect(deletedArgs.indexer?.entityType).toBe('example.todo')
    expect(db[created.id].deletedAt).toBeInstanceOf(Date)
  })

  it('trims padded selected organization ids when scope resolution falls back from empty filter ids', async () => {
    const created = em.create(Todo, { title: 'Scoped', organizationId: defaultOrganizationId, tenantId: defaultTenantId }) as Rec
    created.id = '123e4567-e89b-12d3-a456-426614174052'
    await em.persist(created).flush()
    mockOrganizationScopeOverride = {
      selectedId: ` ${defaultOrganizationId} `,
      filterIds: [],
      allowedIds: null,
      tenantId: defaultTenantId,
    }

    const updateResponse = await route.PUT(new Request('http://x/api/example/todos', {
      method: 'PUT',
      body: JSON.stringify({ id: created.id, title: 'Scoped Updated' }),
      headers: { 'content-type': 'application/json' },
    }))

    expect(updateResponse.status).toBe(200)
    expect(mockDataEngine.updateOrmEntity).toHaveBeenLastCalledWith(expect.objectContaining({
      where: {
        id: created.id,
        organizationId: defaultOrganizationId,
        tenantId: defaultTenantId,
        deletedAt: null,
      },
    }))

    const deleteResponse = await route.DELETE(new Request(`http://x/api/example/todos?id=${created.id}`, { method: 'DELETE' }))

    expect(deleteResponse.status).toBe(200)
    expect(mockDataEngine.deleteOrmEntity).toHaveBeenLastCalledWith(expect.objectContaining({
      where: {
        id: created.id,
        organizationId: defaultOrganizationId,
        tenantId: defaultTenantId,
        deletedAt: null,
      },
    }))
  })

  it('PUT mutation guard uses route resource identity instead of spoofed lock headers', async () => {
    crudMutationGuardService = {
      validateMutation: jest.fn().mockResolvedValue({
        ok: true,
        shouldRunAfterSuccess: false,
      }),
      afterMutationSuccess: jest.fn().mockResolvedValue(undefined),
    }

    const created = em.create(Todo, {
      title: 'X',
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
    }) as Rec
    created.id = '123e4567-e89b-12d3-a456-426614174051'
    await em.persist(created).flush()

    const res = await route.PUT(new Request('http://x/api/example/todos', {
      method: 'PUT',
      body: JSON.stringify({ id: created.id, title: 'X2' }),
      headers: {
        'content-type': 'application/json',
        'x-om-spoof-kind': 'spoof.kind',
        'x-om-spoof-id': 'spoof-id',
      },
    }))

    expect(res.status).toBe(200)
    expect(crudMutationGuardService.validateMutation).toHaveBeenCalledTimes(1)
    expect(crudMutationGuardService.validateMutation).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'example.todo',
      resourceId: created.id,
      requestHeaders: expect.any(Headers),
    }))
  })

  it('DELETE command route delegates event emission to CommandBus (no factory-level emission)', async () => {
    const indexedId = 'line-999'
    commandBus.execute.mockResolvedValue({
      result: { lineId: indexedId, orderId: 'order-1' },
      logEntry: { id: 'log-1' },
    })
    const commandRoute = makeCrudRoute({
      metadata: { DELETE: { requireAuth: true } },
      orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
      indexer: { entityType: 'example.todo' },
      actions: {
        delete: {
          commandId: 'example.todo.delete',
          schema: z.any(),
          response: () => ({ ok: true }),
        },
      },
    })
    const res = await commandRoute.DELETE(new Request('http://x/api/example/todos/command', { method: 'DELETE', body: JSON.stringify({}), headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledWith('example.todo.delete', expect.anything())
    // Command-based paths delegate side effects (events + indexing) entirely to the
    // CommandBus via flushCrudSideEffects(). The factory itself must NOT emit events
    // to avoid duplicates (see commit 3f999f35).
    expect(mockDataEngine.emitOrmEntityEvent).not.toHaveBeenCalled()
  })

  it('POST is blocked by interceptor before hook', async () => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.block-title',
            targetRoute: 'example/todos',
            methods: ['POST'],
            async before(request) {
              const title = request.body?.title
              if (typeof title === 'string' && title.includes('BLOCKED')) {
                return { ok: false, statusCode: 422, message: 'Blocked by interceptor' }
              }
              return { ok: true }
            },
          },
        ],
      },
    ])

    const res = await route.POST(new Request('http://x/api/example/todos', {
      method: 'POST',
      body: JSON.stringify({ title: 'BLOCKED item', is_done: false }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(422)
    const payload = await res.json()
    expect(payload).toMatchObject({
      error: 'Blocked by interceptor',
      interceptorId: 'example.block-title',
    })
  })

  it('GET response is augmented by interceptor after hook', async () => {
    registerApiInterceptors([
      {
        moduleId: 'example',
        interceptors: [
          {
            id: 'example.add-response-flag',
            targetRoute: 'example/todos',
            methods: ['GET'],
            async after(_request, response) {
              return {
                merge: {
                  _interceptor: {
                    ok: true,
                    count: Array.isArray(response.body.items) ? response.body.items.length : 0,
                  },
                },
              }
            },
          },
        ],
      },
    ])

    const res = await route.GET(new Request('http://x/api/example/todos?page=1&pageSize=10&sortField=id&sortDir=asc'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body._interceptor).toEqual({ ok: true, count: 1 })
  })
})

describe('CRUD Factory — optimistic-lock auto-registration', () => {
  beforeEach(() => {
    clearOptimisticLockReadersForTests()
  })

  afterAll(() => {
    clearOptimisticLockReadersForTests()
  })

  function makeMinimalRoute(opts: { eventsResource: string; entity: any }) {
    return makeCrudRoute({
      metadata: { GET: { requireAuth: true } },
      orm: { entity: opts.entity, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId' },
      events: { module: opts.eventsResource.split('.')[0], entity: opts.eventsResource.split('.')[1], persistent: false } as any,
      list: { schema: z.object({}).passthrough() as any },
      create: {
        commandId: `${opts.eventsResource}.create`,
        schema: z.object({}).passthrough() as any,
      },
      update: {
        commandId: `${opts.eventsResource}.update`,
        schema: z.object({ id: z.string() }).passthrough() as any,
      },
      del: {
        commandId: `${opts.eventsResource}.delete`,
        schema: z.object({ id: z.string() }).passthrough() as any,
      },
    })
  }

  it('auto-registers a reader for the route resourceKind at factory call time', () => {
    expect(getAllOptimisticLockReaders()).toEqual({})
    makeMinimalRoute({ eventsResource: 'example.todo', entity: Todo })
    const all = getAllOptimisticLockReaders()
    expect(Object.keys(all)).toContain('example.todo')
    expect(typeof all['example.todo']).toBe('function')
  })

  it('does NOT override an existing hand-wired reader (IfAbsent semantics)', () => {
    const handWired = async () => 'hand-wired'
    registerOptimisticLockReaders({ 'example.todo': handWired })
    makeMinimalRoute({ eventsResource: 'example.todo', entity: Todo })
    expect(getAllOptimisticLockReaders()['example.todo']).toBe(handWired)
  })

  it('skips registration when the entity has no resolvable resourceKind', () => {
    expect(getAllOptimisticLockReaders()).toEqual({})
    // Route with no events.module + no command IDs → resourceKind falls back to 'resource'
    makeCrudRoute({
      metadata: { GET: { requireAuth: true } },
      orm: { entity: Todo },
      list: { schema: z.object({}).passthrough() as any },
    } as any)
    // 'resource' is filtered out by the auto-registration guard
    expect(getAllOptimisticLockReaders()['resource']).toBeUndefined()
  })

  it('the registered reader projects only updatedAt and fails open on schema mismatch', async () => {
    makeMinimalRoute({ eventsResource: 'example.todo', entity: Todo })
    const reader = getAllOptimisticLockReaders()['example.todo']
    expect(reader).toBeDefined()
    let captured: { entity: unknown; filter: Record<string, unknown>; options?: Record<string, unknown> } | null = null
    const fakeEm = {
      async findOne(entity: unknown, filter: Record<string, unknown>, options?: Record<string, unknown>) {
        captured = { entity, filter, options }
        return { updatedAt: new Date('2026-05-26T07:30:00.000Z') }
      },
    } as never
    const out = await reader!(fakeEm, {
      resourceKind: 'example.todo',
      resourceId: 'todo-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(out).toBe('2026-05-26T07:30:00.000Z')
    expect(captured).not.toBeNull()
    expect(captured!.entity).toBe(Todo)
    expect(captured!.filter).toEqual({
      id: 'todo-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    })
    expect(captured!.options).toEqual({ fields: ['updatedAt'] })

    // Fail-open contract: throwing findOne yields null, not a re-thrown error.
    const throwingEm = {
      async findOne() {
        throw new Error('schema mismatch')
      },
    } as never
    const safe = await reader!(throwingEm, {
      resourceKind: 'example.todo',
      resourceId: 'todo-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(safe).toBeNull()
  })
})
