import { GET } from '../route'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const TENANT_ID = '00000000-0000-0000-0000-000000000002'
const ENTITY_ID = '00000000-0000-0000-0000-000000000003'
const LINK_ID = '00000000-0000-0000-0000-000000000004'
const TODO_ID = '00000000-0000-0000-0000-000000000005'

const mockLink = {
  id: LINK_ID,
  todoId: TODO_ID,
  todoSource: 'planner:todo',
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  entity: {
    id: ENTITY_ID,
    displayName: 'Acme Corp',
    kind: 'company',
  },
}

const mockEm = {
  findAndCount: jest.fn(async () => [[mockLink], 1]),
}

const mockQueryEngine = {
  query: jest.fn(async () => ({
    items: [{ id: TODO_ID, title: 'Follow up call', is_done: true }],
  })),
}

const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return mockEm
    if (name === 'queryEngine') return mockQueryEngine
    throw new Error(`Unknown service: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    orgId: ORG_ID,
    tenantId: TENANT_ID,
    isApiKey: false,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({
  decryptEntitiesWithFallbackScope: jest.fn(async () => undefined),
}))

describe('GET /api/customers/todos', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.findAndCount.mockResolvedValue([[mockLink], 1])
    mockQueryEngine.query.mockResolvedValue({
      items: [{ id: TODO_ID, title: 'Follow up call', is_done: true }],
    })
  })

  it('returns 401 when not authenticated', async () => {
    const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValueOnce(null)

    const res = await GET(new Request('http://localhost/api/customers/todos'))
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid params', async () => {
    const res = await GET(new Request('http://localhost/api/customers/todos?page=0'))
    expect(res.status).toBe(400)
  })

  it('returns paginated items with resolved todo title and isDone', async () => {
    const res = await GET(new Request('http://localhost/api/customers/todos?page=1&pageSize=10'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: LINK_ID,
      todoId: TODO_ID,
      todoSource: 'planner:todo',
      todoTitle: 'Follow up call',
      todoIsDone: true,
      customer: { id: ENTITY_ID, displayName: 'Acme Corp', kind: 'company' },
    })
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.totalPages).toBe(1)
  })

  it('filters by organizationId when orgId is set', async () => {
    await GET(new Request('http://localhost/api/customers/todos'))
    const [, where] = mockEm.findAndCount.mock.calls[0]
    expect(where).toMatchObject({ organizationId: ORG_ID, tenantId: TENANT_ID })
  })

  it('omits organizationId filter when orgId is null (all orgs mode)', async () => {
    const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValueOnce({ sub: 'user-1', orgId: null, tenantId: TENANT_ID })

    await GET(new Request('http://localhost/api/customers/todos'))
    const [, where] = mockEm.findAndCount.mock.calls[0]
    expect(where).not.toHaveProperty('organizationId')
    expect(where).toMatchObject({ tenantId: TENANT_ID })
  })

  it('returns all records when all=true (full export)', async () => {
    mockEm.findAndCount.mockResolvedValueOnce([[mockLink, mockLink], 2])

    const res = await GET(new Request('http://localhost/api/customers/todos?all=true'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
    expect(body.totalPages).toBe(1)

    const [, , options] = mockEm.findAndCount.mock.calls[0]
    expect(options).not.toHaveProperty('limit')
    expect(options).not.toHaveProperty('offset')
  })

  it('falls back to null todoTitle/todoIsDone when QueryEngine throws', async () => {
    mockQueryEngine.query.mockRejectedValueOnce(new Error('QueryEngine unavailable'))

    const res = await GET(new Request('http://localhost/api/customers/todos'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items[0].todoTitle).toBeNull()
    expect(body.items[0].todoIsDone).toBeNull()
  })
})
