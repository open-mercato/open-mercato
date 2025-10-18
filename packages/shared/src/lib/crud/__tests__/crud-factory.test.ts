import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'

// ---- Mocks ----
const mockEventBus = { emitEvent: jest.fn() }

type Rec = { id: string; organizationId: string; tenantId: string; title?: string; isDone?: boolean; deletedAt?: Date | null }
let db: Record<string, Rec>
let idSeq = 1

const em = {
  create: (_cls: any, data: any) => ({ ...data, id: `id-${idSeq++}` }),
  persistAndFlush: async (entity: Rec) => { db[entity.id] = { ...(db[entity.id] || {} as any), ...entity } },
  getRepository: (_cls: any) => ({
    find: async (where: any) => Object.values(db).filter((r) => {
      const orgClause = where.organizationId
      const matchesOrg = !orgClause
        ? true
        : (typeof orgClause === 'object' && Array.isArray(orgClause.$in))
          ? orgClause.$in.includes(r.organizationId)
          : r.organizationId === orgClause
      const matchesTenant = !where.tenantId || r.tenantId === where.tenantId
      const matchesDeleted = where.deletedAt === null ? !r.deletedAt : true
      return matchesOrg && matchesTenant && matchesDeleted
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
    removeAndFlush: async (entity: Rec) => { delete db[entity.id] },
  }),
}

const queryEngine = {
  query: jest.fn(async (_entityId: any, _q: any) => ({ items: [{ id: 'id-1', title: 'A', is_done: false, organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenant_id: '123e4567-e89b-12d3-a456-426614174000' }], total: 1 })),
}

const mockDataEngine = {
  createOrmEntity: jest.fn(async ({ entity, data }: any) => {
    const created = em.create(entity, data)
    await em.persistAndFlush(created as any)
    return created
  }),
  updateOrmEntity: jest.fn(async ({ entity, where, apply }: any) => {
    const current = await (em.getRepository(entity).findOne(where) as any)
    if (!current) return null
    await apply(current)
    await em.persistAndFlush(current)
    return current
  }),
  deleteOrmEntity: jest.fn(async ({ entity, where, soft, softDeleteField }: any) => {
    const repo = em.getRepository(entity)
    const current = await (repo.findOne(where) as any)
    if (!current) return null
    if (soft !== false) { (current as any)[softDeleteField || 'deletedAt'] = new Date(); await em.persistAndFlush(current) }
    else await repo.removeAndFlush(current)
    return current
  }),
  setCustomFields: jest.fn(async (args: any) => {
    await (setRecordCustomFields as any)(em, args)
  }),
  emitOrmEntityEvent: jest.fn(async () => {}),
}

const accessLogService = {
  log: jest.fn(async () => {}),
}

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => ({
      em,
      queryEngine,
      eventBus: mockEventBus,
      dataEngine: mockDataEngine,
      accessLogService,
    } as any)[name],
  })
}))

jest.mock('@/lib/auth/server', () => ({
  getAuthFromCookies: async () => ({ sub: 'u1', orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId: '123e4567-e89b-12d3-a456-426614174000', roles: ['admin'] })
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
    const createdArgs = mockDataEngine.emitOrmEntityEvent.mock.calls[0][0]
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
    const created = em.create(Todo, { title: 'X', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId: '123e4567-e89b-12d3-a456-426614174000' }) as Rec
    // Force UUID id to satisfy validation
    created.id = '123e4567-e89b-12d3-a456-426614174001'
    await em.persistAndFlush(created)
    const res = await route.PUT(new Request('http://x/api/example/todos', { method: 'PUT', body: JSON.stringify({ id: created.id, title: 'X2', cf_priority: 5 }), headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBe(200)
    expect(setRecordCustomFields).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ values: { priority: 5 } }))
    expect(mockDataEngine.emitOrmEntityEvent).toHaveBeenCalledTimes(1)
    const updatedArgs = mockDataEngine.emitOrmEntityEvent.mock.calls[0][0]
    expect(updatedArgs.action).toBe('updated')
    expect(updatedArgs.identifiers.id).toBe(created.id)
    expect(updatedArgs.indexer?.entityType).toBe('example.todo')
    expect(db[created.id].title).toBe('X2')
  })

  it('DELETE soft-deletes entity and emits deleted event', async () => {
    const created = em.create(Todo, { title: 'Y', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId: '123e4567-e89b-12d3-a456-426614174000' }) as Rec
    created.id = '123e4567-e89b-12d3-a456-426614174002'
    await em.persistAndFlush(created)
    const res = await route.DELETE(new Request(`http://x/api/example/todos?id=${created.id}`, { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(mockDataEngine.emitOrmEntityEvent).toHaveBeenCalledTimes(1)
    const deletedArgs = mockDataEngine.emitOrmEntityEvent.mock.calls[0][0]
    expect(deletedArgs.action).toBe('deleted')
    expect(deletedArgs.identifiers.id).toBe(created.id)
    expect(deletedArgs.indexer?.entityType).toBe('example.todo')
    expect(db[created.id].deletedAt).toBeInstanceOf(Date)
  })
})
