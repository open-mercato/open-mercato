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
    find: async (where: any) => Object.values(db).filter((r) =>
      (!where.organizationId || r.organizationId === where.organizationId) &&
      (!where.tenantId || r.tenantId === where.tenantId) &&
      (where.deletedAt === null ? !r.deletedAt : true)
    ),
    findOne: async (where: any) => Object.values(db).find((r) => r.id === where.id && r.organizationId === where.organizationId && r.tenantId === where.tenantId) || null,
    removeAndFlush: async (entity: Rec) => { delete db[entity.id] },
  }),
}

const queryEngine = {
  query: jest.fn(async (_entityId: any, _q: any) => ({ items: [{ id: 'id-1', title: 'A', is_done: false, organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenant_id: '123e4567-e89b-12d3-a456-426614174000' }], total: 1 })),
}

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => ({
      em,
      queryEngine,
      eventBus: mockEventBus,
      dataEngine: {
        setCustomFields: async (args: any) => {
          // Bridge into helper so existing expectations still work
          await (setRecordCustomFields as any)(em, args)
        },
      },
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
  })

  const querySchema = z.object({ page: z.coerce.number().default(1), pageSize: z.coerce.number().default(50), sortField: z.string().default('id'), sortDir: z.enum(['asc','desc']).default('asc'), format: z.enum(['json','csv']).optional() })
  const createSchema = z.object({ title: z.string().min(1), is_done: z.boolean().optional().default(false), cf_priority: z.number().optional() })
  const updateSchema = z.object({ id: z.string(), title: z.string().optional(), is_done: z.boolean().optional(), cf_priority: z.number().optional() })

  const route = makeCrudRoute({
    metadata: { GET: { requireAuth: true }, POST: { requireAuth: true }, PUT: { requireAuth: true }, DELETE: { requireAuth: true } },
    orm: { entity: Todo, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
    events: { module: 'example', entity: 'todo', persistent: true },
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
  })

  it('GET returns CSV when format=csv', async () => {
    const res = await route.GET(new Request('http://x/api/example/todos?page=1&pageSize=10&sortField=id&sortDir=asc&format=csv'))
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('todos.csv')
    const text = await res.text()
    expect(text.split('\n')[0]).toBe('id,title,is_done')
  })

  it('POST creates entity, saves custom fields, emits created event', async () => {
    const res = await route.POST(new Request('http://x/api/example/todos', { method: 'POST', body: JSON.stringify({ title: 'B', is_done: true, cf_priority: 3 }), headers: { 'content-type': 'application/json' } }))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBeDefined()
    // CF saved
    expect(setRecordCustomFields).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityId: 'example.todo', values: { priority: 3 } }))
    // Event emitted
    expect(mockEventBus.emitEvent).toHaveBeenCalledWith('example.todo.created', expect.anything(), { persistent: true })
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
    expect(mockEventBus.emitEvent).toHaveBeenCalledWith('example.todo.updated', { id: created.id }, { persistent: true })
    expect(db[created.id].title).toBe('X2')
  })

  it('DELETE soft-deletes entity and emits deleted event', async () => {
    const created = em.create(Todo, { title: 'Y', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId: '123e4567-e89b-12d3-a456-426614174000' }) as Rec
    created.id = '123e4567-e89b-12d3-a456-426614174002'
    await em.persistAndFlush(created)
    const res = await route.DELETE(new Request(`http://x/api/example/todos?id=${created.id}`, { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(mockEventBus.emitEvent).toHaveBeenCalledWith('example.todo.deleted', { id: created.id }, { persistent: true })
    expect(db[created.id].deletedAt).toBeInstanceOf(Date)
  })
})
