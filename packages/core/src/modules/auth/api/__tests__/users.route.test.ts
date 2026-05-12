/** @jest-environment node */

import { GET, POST, PUT } from '@open-mercato/core/modules/auth/api/users/route'
import { Role, RoleAcl, User } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'

const mockGetAuthFromRequest = jest.fn()
const mockLoadAcl = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockLoadCustomFieldValues = jest.fn()
const mockLogCrudAccess = jest.fn()

const mockSearchTokenExecute = jest.fn()
const mockSearchTokenWhere = jest.fn().mockImplementation(() => searchTokenQueryBuilder)
const mockSearchTokenHaving = jest.fn().mockImplementation(() => searchTokenQueryBuilder)
const mockSearchTokenGroupBy = jest.fn().mockImplementation(() => searchTokenQueryBuilder)
const mockSearchTokenSelect = jest.fn().mockImplementation(() => searchTokenQueryBuilder)
const searchTokenQueryBuilder: any = {
  select: mockSearchTokenSelect,
  where: mockSearchTokenWhere,
  groupBy: mockSearchTokenGroupBy,
  having: mockSearchTokenHaving,
  execute: mockSearchTokenExecute,
}
const mockSelectFrom = jest.fn((table: string) => {
  if (table === 'search_tokens') return searchTokenQueryBuilder
  throw new Error(`Unexpected selectFrom ${table}`)
})
const mockKysely = { selectFrom: mockSelectFrom }

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  getKysely: jest.fn(() => mockKysely),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { loadAcl: mockLoadAcl }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

type MockCrudAction = {
  schema?: { parse: (input: unknown) => Record<string, unknown> }
  mapInput?: (args: {
    parsed: Record<string, unknown>
    raw: Record<string, unknown>
    ctx: { request: Request }
  }) => Promise<unknown> | unknown
  status?: number
}

async function mockRunCrudAction(action: MockCrudAction | undefined, request: Request): Promise<Response> {
  try {
    const raw = await request.json().catch(() => ({})) as Record<string, unknown>
    const parsed = action?.schema ? action.schema.parse(raw) : raw
    if (action?.mapInput) await action.mapInput({ parsed, raw, ctx: { request } })
    return new Response(JSON.stringify({ id: 'created-id' }), {
      status: action?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const httpError = err as { status?: unknown; body?: unknown; message?: string }
    if (typeof httpError.status === 'number') {
      return new Response(JSON.stringify(httpError.body ?? { error: httpError.message ?? 'Request failed' }), {
        status: httpError.status,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw err
  }
}

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: { metadata: unknown; actions?: { create?: MockCrudAction; update?: MockCrudAction } }) => ({
    metadata: opts.metadata,
    POST: jest.fn((request: Request) => mockRunCrudAction(opts.actions?.create, request)),
    PUT: jest.fn((request: Request) => mockRunCrudAction(opts.actions?.update, request)),
    DELETE: jest.fn(),
  })),
  logCrudAccess: jest.fn((args: unknown) => mockLogCrudAccess(args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn((args: unknown) => mockLoadCustomFieldValues(args)),
}))

const tenantId = '123e4567-e89b-12d3-a456-426614174001'
const organizationId = '223e4567-e89b-12d3-a456-426614174001'
const secondaryOrganizationId = '223e4567-e89b-12d3-a456-426614174002'
const roleId = '323e4567-e89b-12d3-a456-426614174001'

function makeRequest(path = '/api/auth/users') {
  return new Request(`http://localhost${path}`, { method: 'GET' })
}

describe('GET /api/auth/users', () => {
  beforeEach(() => {
    mockGetAuthFromRequest.mockReset()
    mockLoadAcl.mockReset()
    mockEm.find.mockReset()
    mockEm.findOne.mockReset()
    mockEm.findAndCount.mockReset()
    mockEm.getKysely.mockClear()
    mockFindWithDecryption.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockLoadCustomFieldValues.mockReset()
    mockLogCrudAccess.mockReset()
    mockContainer.resolve.mockClear()
    mockSelectFrom.mockClear()
    mockSearchTokenSelect.mockClear()
    mockSearchTokenWhere.mockClear()
    mockSearchTokenGroupBy.mockClear()
    mockSearchTokenHaving.mockClear()
    mockSearchTokenExecute.mockReset()
    mockSearchTokenExecute.mockResolvedValue([])
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId,
      orgId: organizationId,
      isSuperAdmin: false,
      roles: ['admin'],
    })
    mockLoadAcl.mockResolvedValue({ isSuperAdmin: false })
    mockEm.find.mockResolvedValue([])
    mockEm.findOne.mockResolvedValue(null)
    mockEm.findAndCount.mockResolvedValue([[], 0])
    mockFindWithDecryption.mockResolvedValue([])
    mockFindOneWithDecryption.mockResolvedValue(null)
    mockLoadCustomFieldValues.mockResolvedValue({})
    mockLogCrudAccess.mockResolvedValue(undefined)
  })

  test('returns an empty collection when unauthenticated', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce(null)

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ items: [], total: 0, totalPages: 1 })
    expect(mockContainer.resolve).not.toHaveBeenCalled()
  })

  test('returns an empty collection for non-superadmin users without tenant context', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce({
      sub: 'user-1',
      tenantId: null,
      orgId: organizationId,
      roles: ['admin'],
    })
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: false })

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ items: [], total: 0, totalPages: 1, isSuperAdmin: false })
    expect(mockEm.findAndCount).not.toHaveBeenCalled()
  })

  test('resolves search terms via search_tokens (email column is encrypted) and scopes tokens by tenant', async () => {
    const matchedUserId = '423e4567-e89b-12d3-a456-426614174001'
    mockSearchTokenExecute.mockResolvedValueOnce([{ entity_id: matchedUserId }])
    mockEm.findAndCount.mockResolvedValueOnce([
      [
        {
          id: matchedUserId,
          email: 'admin@acme.com',
          tenantId,
          organizationId,
        },
      ],
      1,
    ])

    const response = await GET(makeRequest('/api/auth/users?search=admin%40acme.com&page=1&pageSize=50'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockSelectFrom).toHaveBeenCalledWith('search_tokens')
    const entityTypeCall = mockSearchTokenWhere.mock.calls.find(
      (call: unknown[]) => call[0] === 'entity_type' && call[1] === '=' && call[2] === 'auth:user',
    )
    expect(entityTypeCall).toBeDefined()
    const tenantScopeCall = mockSearchTokenWhere.mock.calls.find((call: unknown[]) => {
      const clause = call[0] as { toOperationNode?: () => { sqlFragments?: string[]; parameters?: Array<{ value?: unknown }> } } | undefined
      const node = clause && typeof clause === 'object' && typeof clause.toOperationNode === 'function'
        ? clause.toOperationNode()
        : null
      if (!node || !Array.isArray(node.sqlFragments)) return false
      const joined = node.sqlFragments.join('?')
      if (!joined.includes('tenant_id is not distinct from')) return false
      const params = Array.isArray(node.parameters) ? node.parameters : []
      return params.some((p) => p && typeof p === 'object' && 'value' in p && p.value === tenantId)
    })
    expect(tenantScopeCall).toBeDefined()
    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }
    expect(where.$and).toEqual(expect.arrayContaining([
      { deletedAt: null },
      { tenantId },
      { id: { $in: [matchedUserId] } },
    ]))
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      email: 'admin@acme.com',
      tenantId,
      organizationId,
    })
    expect(body.isSuperAdmin).toBe(false)
  })

  test('includes matching organization names in the unified search clause', async () => {
    mockEm.find
      .mockResolvedValueOnce([{ id: organizationId }])
      .mockResolvedValueOnce([])
    mockEm.findAndCount.mockResolvedValueOnce([[], 0])

    const response = await GET(makeRequest('/api/auth/users?search=Acme&page=1&pageSize=50'))
    const body = await response.json()

    expect(response.status).toBe(200)
    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }
    expect(where.$and).toEqual(expect.arrayContaining([
      { deletedAt: null },
      { tenantId },
      { organizationId: { $in: [organizationId] } },
    ]))
    expect(body).toEqual({ items: [], total: 0, totalPages: 1, isSuperAdmin: false })
  })

  test('includes users whose role names match the unified search term', async () => {
    const matchedUserId = '523e4567-e89b-12d3-a456-426614174055'
    mockEm.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: roleId, name: 'admin', tenantId }])
      .mockResolvedValueOnce([{ user: { id: matchedUserId }, role: { id: roleId } }])
    mockEm.findAndCount.mockResolvedValueOnce([[], 0])

    const response = await GET(makeRequest('/api/auth/users?search=admin&page=1&pageSize=50'))
    const body = await response.json()

    expect(response.status).toBe(200)
    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }
    expect(where.$and).toEqual(expect.arrayContaining([
      { deletedAt: null },
      { tenantId },
      { id: { $in: [matchedUserId] } },
    ]))
    expect(body).toEqual({ items: [], total: 0, totalPages: 1, isSuperAdmin: false })
  })

  test('returns empty result when search_tokens yield no matches', async () => {
    mockSearchTokenExecute.mockResolvedValueOnce([])

    const response = await GET(makeRequest('/api/auth/users?search=nobody%40example.com'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ items: [], total: 0, totalPages: 1, isSuperAdmin: false })
    expect(mockEm.findAndCount).not.toHaveBeenCalled()
  })

  test('superadmin search does not apply tenant scope on search_tokens', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce({
      sub: 'user-1',
      tenantId: null,
      orgId: organizationId,
      roles: ['admin'],
    })
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: true })
    const matchedUserId = '423e4567-e89b-12d3-a456-426614174002'
    mockSearchTokenExecute.mockResolvedValueOnce([{ entity_id: matchedUserId }])
    mockEm.findAndCount.mockResolvedValueOnce([
      [{ id: matchedUserId, email: 'cross-tenant@example.com', tenantId: null, organizationId: null }],
      1,
    ])

    const response = await GET(makeRequest('/api/auth/users?search=cross'))
    const body = await response.json()

    expect(response.status).toBe(200)
    const tenantScopeCalled = mockSearchTokenWhere.mock.calls.some((call: unknown[]) => {
      const clause = call[0] as { toOperationNode?: () => { sqlFragments?: string[] } } | undefined
      const node = clause && typeof clause === 'object' && typeof clause.toOperationNode === 'function'
        ? clause.toOperationNode()
        : null
      if (!node || !Array.isArray(node.sqlFragments)) return false
      return node.sqlFragments.join('?').includes('tenant_id is not distinct from')
    })
    expect(tenantScopeCalled).toBe(false)
    expect(body.isSuperAdmin).toBe(true)
    expect(body.items).toHaveLength(1)
  })

  test('intersects search matches with an existing role-based id filter', async () => {
    const firstUserId = '523e4567-e89b-12d3-a456-426614174101'
    const secondUserId = '523e4567-e89b-12d3-a456-426614174102'
    mockEm.find.mockResolvedValueOnce([
      { user: { id: firstUserId }, role: { id: roleId } },
      { user: { id: secondUserId }, role: { id: roleId } },
    ])
    mockSearchTokenExecute.mockResolvedValueOnce([{ entity_id: secondUserId }])
    mockEm.findAndCount.mockResolvedValueOnce([
      [{ id: secondUserId, email: 'match@example.com', tenantId, organizationId }],
      1,
    ])

    const response = await GET(makeRequest(`/api/auth/users?roleId=${roleId}&search=match`))
    const body = await response.json()

    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }
    expect(where.$and).toEqual(expect.arrayContaining([
      { id: { $in: [firstUserId, secondUserId] } },
      { id: { $in: [secondUserId] } },
    ]))
    expect(body.total).toBe(1)
    expect(body.items[0].id).toBe(secondUserId)
  })

  test('short-circuits with empty result when role filter has no matching users', async () => {
    mockEm.find.mockResolvedValueOnce([])

    const response = await GET(makeRequest(`/api/auth/users?roleId=${roleId}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ items: [], total: 0, totalPages: 1 })
    expect(mockEm.findAndCount).not.toHaveBeenCalled()
  })

  test('applies roleId filter for a single role when users are found', async () => {
    const matchedUserId = '523e4567-e89b-12d3-a456-426614174001'
    mockEm.find.mockResolvedValueOnce([{ user: { id: matchedUserId }, role: { id: roleId } }])
    mockEm.findAndCount.mockResolvedValueOnce([
      [{ id: matchedUserId, email: 'role-filtered@example.com', tenantId, organizationId }],
      1,
    ])

    const response = await GET(makeRequest(`/api/auth/users?roleId=${roleId}`))
    const body = await response.json()

    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }
    expect(where.$and).toEqual(expect.arrayContaining([
      { id: { $in: [matchedUserId] } },
    ]))
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].email).toBe('role-filtered@example.com')
  })

  test('supports multiple roleId params and narrows query to union of matched user ids', async () => {
    const secondRoleId = '323e4567-e89b-12d3-a456-426614174002'
    const firstUserId = '523e4567-e89b-12d3-a456-426614174011'
    const secondUserId = '523e4567-e89b-12d3-a456-426614174012'
    mockEm.find.mockResolvedValueOnce([
      { user: { id: firstUserId }, role: { id: roleId } },
      { user: secondUserId, role: { id: secondRoleId } },
      { user: { id: firstUserId }, role: { id: secondRoleId } },
    ])
    mockEm.findAndCount.mockResolvedValueOnce([
      [
        { id: firstUserId, email: 'first@example.com', tenantId, organizationId },
        { id: secondUserId, email: 'second@example.com', tenantId, organizationId },
      ],
      2,
    ])

    const response = await GET(
      makeRequest(`/api/auth/users?roleId=${roleId}&roleId=${secondRoleId}&roleId=${secondRoleId}`),
    )
    const body = await response.json()

    const roleFilter = mockEm.find.mock.calls[0][1] as { role?: { $in?: string[] } }
    expect(roleFilter.role?.$in).toEqual(expect.arrayContaining([roleId, secondRoleId]))
    expect(roleFilter.role?.$in).toHaveLength(2)

    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }
    const idClause = where.$and.find((clause) => {
      const value = (clause as { id?: { $in?: string[] } }).id
      return Array.isArray(value?.$in)
    }) as { id: { $in: string[] } }
    expect(idClause.id.$in).toEqual(expect.arrayContaining([firstUserId, secondUserId]))
    expect(idClause.id.$in).toHaveLength(2)
    expect(body.total).toBe(2)
    expect(body.items).toHaveLength(2)
  })

  test('allows superadmin to query by organization without forcing tenant filter', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce({
      sub: 'user-1',
      tenantId: null,
      orgId: organizationId,
      roles: ['admin'],
    })
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: true })
    mockEm.findAndCount.mockResolvedValueOnce([[], 0])

    const response = await GET(
      makeRequest(`/api/auth/users?organizationId=${secondaryOrganizationId}&page=1&pageSize=10`),
    )
    const body = await response.json()

    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }
    expect(where.$and).toEqual(expect.arrayContaining([
      { organizationId: secondaryOrganizationId },
    ]))
    expect(where.$and).not.toEqual(expect.arrayContaining([
      { tenantId },
    ]))
    expect(body.isSuperAdmin).toBe(true)
  })

  test('allows assigning a role whose wildcard ACL is covered by actor wildcard ACL', async () => {
    const employeeRoleId = '323e4567-e89b-12d3-a456-426614174776'
    mockLoadAcl.mockResolvedValueOnce({
      isSuperAdmin: false,
      features: ['auth.users.create', 'example.*'],
      organizations: null,
    })
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === Organization) return { id: organizationId, tenant: { id: tenantId } }
      if (entity === Role) return { id: employeeRoleId, name: 'employee', tenantId }
      if (entity === RoleAcl) {
        return {
          isSuperAdmin: false,
          featuresJson: ['example.widgets.*'],
          organizationsJson: null,
          tenantId,
        }
      }
      return null
    })

    const response = await POST(new Request('http://localhost/api/auth/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'employee-create@example.com',
        password: 'StrongSecret123!',
        organizationId,
        roles: [employeeRoleId],
      }),
    }))

    expect(response.status).toBe(201)
  })

  test('rejects limited users assigning a role whose ACL grants features outside the actor ACL', async () => {
    const privilegedRoleId = '323e4567-e89b-12d3-a456-426614174777'
    mockLoadAcl.mockResolvedValueOnce({
      isSuperAdmin: false,
      features: ['auth.users.create'],
      organizations: null,
    })
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === Organization) return { id: organizationId, tenant: { id: tenantId } }
      if (entity === Role) return { id: privilegedRoleId, name: 'Tenant Admin', tenantId }
      if (entity === RoleAcl) {
        return {
          isSuperAdmin: false,
          featuresJson: ['auth.*'],
          organizationsJson: null,
          tenantId,
        }
      }
      return null
    })

    const response = await POST(new Request('http://localhost/api/auth/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'limited-create@example.com',
        password: 'StrongSecret123!',
        organizationId,
        roles: [privilegedRoleId],
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Cannot grant feature')
  })

  test('rejects limited users reassigning an existing user to a privileged role on update', async () => {
    const userId = '523e4567-e89b-12d3-a456-426614174501'
    const privilegedRoleId = '323e4567-e89b-12d3-a456-426614174778'
    mockLoadAcl.mockResolvedValueOnce({
      isSuperAdmin: false,
      features: ['auth.users.edit'],
      organizations: null,
    })
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === User) return { id: userId, tenantId, organizationId }
      if (entity === Role) return { id: privilegedRoleId, name: 'Tenant Admin', tenantId }
      if (entity === RoleAcl) {
        return {
          isSuperAdmin: false,
          featuresJson: ['api_keys.create'],
          organizationsJson: null,
          tenantId,
        }
      }
      return null
    })

    const response = await PUT(new Request('http://localhost/api/auth/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: userId,
        roles: [privilegedRoleId],
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('Cannot grant feature api_keys.create')
  })
})
