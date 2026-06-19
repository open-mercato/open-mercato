/** @jest-environment node */

import { Role, User } from '@open-mercato/core/modules/auth/data/entities'

const mockGetAuthFromRequest = jest.fn()
const mockLoadAcl = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockLogCrudAccess = jest.fn()
const mockCommandExecute = jest.fn()

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  count: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { loadAcl: mockLoadAcl, invalidateUserCache: jest.fn() }
    if (token === 'commandBus') return { execute: mockCommandExecute }
    if (token === 'cache') return null
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
    ctx: { request: Request; container: typeof mockContainer; auth: unknown }
  }) => Promise<unknown> | unknown
  status?: number
}

async function runMockAction(
  action: MockCrudAction | undefined,
  request: Request,
  method: 'POST' | 'PUT' | 'DELETE',
): Promise<Response> {
  const auth = await mockGetAuthFromRequest(request)
  try {
    const url = new URL(request.url)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const raw = { body, query: Object.fromEntries(url.searchParams.entries()) }
    const parsed = action?.schema ? action.schema.parse(method === 'DELETE' ? raw : body) : (method === 'DELETE' ? raw : body)
    if (action?.mapInput) {
      await action.mapInput({ parsed: parsed as Record<string, unknown>, raw, ctx: { request, container: mockContainer, auth } })
    }
    return new Response(JSON.stringify({ ok: true, id: 'result-id' }), {
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
  makeCrudRoute: jest.fn((opts: { metadata: unknown; actions?: { create?: MockCrudAction; update?: MockCrudAction; delete?: MockCrudAction } }) => ({
    metadata: opts.metadata,
    POST: jest.fn((request: Request) => runMockAction(opts.actions?.create, request, 'POST')),
    PUT: jest.fn((request: Request) => runMockAction(opts.actions?.update, request, 'PUT')),
    DELETE: jest.fn((request: Request) => runMockAction(opts.actions?.delete, request, 'DELETE')),
  })),
  logCrudAccess: jest.fn((args: unknown) => mockLogCrudAccess(args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  getSelectedTenantFromRequest: jest.fn(() => null),
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: null, filterIds: null, allowedIds: null, tenantId: null })),
}))

jest.mock('@open-mercato/core/modules/auth/lib/consentIntegrity', () => ({
  verifyConsentIntegrityHash: jest.fn(() => true),
}))

// Imported after mocks are registered.
import { PUT as usersPut, DELETE as usersDelete } from '@open-mercato/core/modules/auth/api/users/route'
import { GET as usersAclGet, PUT as usersAclPut } from '@open-mercato/core/modules/auth/api/users/acl/route'
import { GET as consentsGet } from '@open-mercato/core/modules/auth/api/users/consents/route'
import { POST as createRolePost, PUT as rolesPut, DELETE as rolesDelete } from '@open-mercato/core/modules/auth/api/roles/route'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const actorId = '33333333-3333-4333-8333-333333333333'
const orgId = '44444444-4444-4444-8444-444444444444'
const foreignUserId = '55555555-5555-4555-8555-555555555555'
const sameTenantUserId = '66666666-6666-4666-8666-666666666666'
const foreignRoleId = '77777777-7777-4777-8777-777777777777'
const sameTenantRoleId = '88888888-8888-4888-8888-888888888888'
const nullTenantRoleId = '99999999-9999-4999-8999-999999999999'

function setActor(opts: { isSuperAdmin?: boolean; tenantId?: string | null; organizations?: string[] | null } = {}) {
  const isSuperAdmin = opts.isSuperAdmin ?? false
  mockGetAuthFromRequest.mockResolvedValue({
    sub: actorId,
    tenantId: opts.tenantId === undefined ? tenantA : opts.tenantId,
    orgId,
    isSuperAdmin,
    roles: isSuperAdmin ? ['superadmin'] : ['admin'],
  })
  mockLoadAcl.mockResolvedValue({ isSuperAdmin, features: isSuperAdmin ? ['*'] : ['auth.users.edit'], organizations: opts.organizations ?? null })
}

function jsonRequest(url: string, method: string, body?: Record<string, unknown>): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEm.find.mockResolvedValue([])
  mockEm.findOne.mockResolvedValue(null)
  mockEm.findAndCount.mockResolvedValue([[], 0])
  mockEm.count.mockResolvedValue(0)
  mockFindWithDecryption.mockResolvedValue([])
  mockCommandExecute.mockResolvedValue({ result: { ok: true } })
  mockLogCrudAccess.mockResolvedValue(undefined)
})

function mockUserTargets() {
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: { id?: string }) => {
    if (entity === User) {
      if (where?.id === foreignUserId) return { id: foreignUserId, tenantId: tenantB, organizationId: orgId }
      if (where?.id === sameTenantUserId) return { id: sameTenantUserId, tenantId: tenantA, organizationId: orgId }
    }
    return null
  })
}

function mockRoleTargets() {
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: { id?: string }) => {
    if (entity === Role) {
      if (where?.id === foreignRoleId) return { id: foreignRoleId, tenantId: tenantB }
      if (where?.id === sameTenantRoleId) return { id: sameTenantRoleId, tenantId: tenantA }
      if (where?.id === nullTenantRoleId) return { id: nullTenantRoleId, tenantId: null }
    }
    return null
  })
}

describe('auth user target-ownership guards', () => {
  test('tenant A admin cannot PUT a tenant B user (404)', async () => {
    setActor()
    mockUserTargets()
    const res = await usersPut(jsonRequest('http://localhost/api/auth/users', 'PUT', { id: foreignUserId, name: 'X' }))
    expect(res.status).toBe(404)
  })

  test('tenant A admin can PUT a same-tenant user (200)', async () => {
    setActor()
    mockUserTargets()
    const res = await usersPut(jsonRequest('http://localhost/api/auth/users', 'PUT', { id: sameTenantUserId, name: 'X' }))
    expect(res.status).toBe(200)
  })

  test('tenant A admin cannot DELETE a tenant B user (404)', async () => {
    setActor()
    mockUserTargets()
    const res = await usersDelete(jsonRequest(`http://localhost/api/auth/users?id=${foreignUserId}`, 'DELETE'))
    expect(res.status).toBe(404)
  })

  test('superadmin can PUT a tenant B user (200)', async () => {
    setActor({ isSuperAdmin: true, tenantId: tenantB })
    mockUserTargets()
    const res = await usersPut(jsonRequest('http://localhost/api/auth/users', 'PUT', { id: foreignUserId, name: 'X' }))
    expect(res.status).toBe(200)
  })

  test('tenant A admin cannot read a tenant B user ACL (404)', async () => {
    setActor()
    mockUserTargets()
    const res = await usersAclGet(jsonRequest(`http://localhost/api/auth/users/acl?userId=${foreignUserId}`, 'GET'))
    expect(res.status).toBe(404)
  })

  test('tenant A admin cannot PUT a tenant B user ACL (404)', async () => {
    setActor()
    mockUserTargets()
    const res = await usersAclPut(jsonRequest('http://localhost/api/auth/users/acl', 'PUT', { userId: foreignUserId, features: [] }))
    expect(res.status).toBe(404)
  })

  test('tenant A admin cannot read a tenant B user consents (404)', async () => {
    setActor()
    mockUserTargets()
    const res = await consentsGet(jsonRequest(`http://localhost/api/auth/users/consents?userId=${foreignUserId}`, 'GET'))
    expect(res.status).toBe(404)
  })
})

describe('auth role target-ownership guards', () => {
  test('tenant A admin cannot UPDATE a tenant B role (404)', async () => {
    setActor()
    mockRoleTargets()
    const res = await rolesPut(jsonRequest('http://localhost/api/auth/roles', 'PUT', { id: foreignRoleId, name: 'X' }))
    expect(res.status).toBe(404)
  })

  test('tenant A admin can UPDATE a same-tenant role (200)', async () => {
    setActor()
    mockRoleTargets()
    const res = await rolesPut(jsonRequest('http://localhost/api/auth/roles', 'PUT', { id: sameTenantRoleId, name: 'X' }))
    expect(res.status).toBe(200)
  })

  test('tenant A admin cannot DELETE a tenant B role (404)', async () => {
    setActor()
    mockRoleTargets()
    const res = await rolesDelete(jsonRequest(`http://localhost/api/auth/roles?id=${foreignRoleId}`, 'DELETE'))
    expect(res.status).toBe(404)
  })

  test('non-superadmin cannot mutate a null-tenant role (404)', async () => {
    setActor()
    mockRoleTargets()
    const res = await rolesPut(jsonRequest('http://localhost/api/auth/roles', 'PUT', { id: nullTenantRoleId, name: 'X' }))
    expect(res.status).toBe(404)
  })

  test('superadmin can UPDATE a tenant B role (200)', async () => {
    setActor({ isSuperAdmin: true, tenantId: tenantB })
    mockRoleTargets()
    const res = await rolesPut(jsonRequest('http://localhost/api/auth/roles', 'PUT', { id: foreignRoleId, name: 'X' }))
    expect(res.status).toBe(200)
  })

  test('tenant A admin cannot create a role in a foreign tenant (403)', async () => {
    setActor()
    mockRoleTargets()
    const res = await createRolePost(jsonRequest('http://localhost/api/auth/roles', 'POST', { name: 'New Role', tenantId: tenantB }))
    expect(res.status).toBe(403)
  })

  test('tenant A admin can create a role in its own tenant (201)', async () => {
    setActor()
    mockRoleTargets()
    const res = await createRolePost(jsonRequest('http://localhost/api/auth/roles', 'POST', { name: 'New Role', tenantId: tenantA }))
    expect(res.status).toBe(201)
  })
})
