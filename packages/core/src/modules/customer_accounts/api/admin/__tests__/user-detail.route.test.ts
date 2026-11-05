/** @jest-environment node */
import {
  CustomerRole,
  CustomerUser,
  CustomerUserRole,
} from '@open-mercato/core/modules/customer_accounts/data/entities'

const mockGetAuth = jest.fn()
const mockRbac = { userHasAllFeatures: jest.fn() }
const mockEmFind = jest.fn()
const mockEmFindOne = jest.fn()
const mockEmCreate = jest.fn()
const mockEmPersist = jest.fn()
const mockEmFlush = jest.fn()
const mockEmNativeUpdate = jest.fn()
const mockEmNativeDelete = jest.fn()
const mockInvalidateUserCache = jest.fn()
const mockSoftDelete = jest.fn()
const mockRevokeAllUserSessions = jest.fn()
const mockEmit = jest.fn(async () => undefined)

const mockEm: Record<string, unknown> = {
  find: mockEmFind,
  findOne: mockEmFindOne,
  create: mockEmCreate,
  persist: mockEmPersist,
  flush: mockEmFlush,
  nativeUpdate: mockEmNativeUpdate,
  nativeDelete: mockEmNativeDelete,
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return mockRbac
    if (token === 'em') return mockEm
    if (token === 'customerRbacService') return { invalidateUserCache: mockInvalidateUserCache }
    if (token === 'customerUserService') return { softDelete: mockSoftDelete }
    if (token === 'customerSessionService') return { revokeAllUserSessions: mockRevokeAllUserSessions }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuth(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: any, entity: any, where: any, options?: any) => em.find(entity, where, options),
  findOneWithDecryption: (em: any, entity: any, where: any, options?: any) => em.findOne(entity, where, options),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

import { DELETE, GET, PUT } from '@open-mercato/core/modules/customer_accounts/api/admin/users/[id]'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const foreignOrgId = '55555555-5555-4555-8555-555555555555'
const adminId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'
const roleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const targetUser = {
  id: userId,
  email: 'target@example.com',
  displayName: 'Target',
  isActive: true,
  tenantId,
  organizationId: orgId,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

const foreignTargetUser = {
  ...targetUser,
  organizationId: foreignOrgId,
}

function buildRequest(body: unknown) {
  return new Request(`http://localhost/api/customer_accounts/admin/users/${userId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function buildMethodRequest(method: 'GET' | 'PUT' | 'DELETE', body?: unknown) {
  return new Request(`http://localhost/api/customer_accounts/admin/users/${userId}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('admin customer-user detail routes — target organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuth.mockResolvedValue({ sub: adminId, tenantId, orgId })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockEmFind.mockResolvedValue([])
    mockEmFindOne.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== CustomerUser || where?.id !== userId) return null
      return where.organizationId === orgId ? null : foreignTargetUser
    })
  })

  it('returns 404 for a same-tenant foreign-org GET target', async () => {
    const res = await GET(buildMethodRequest('GET'), { params: { id: userId } })

    expect(res.status).toBe(404)
    expect(mockEmFind).not.toHaveBeenCalled()
    expect(mockEmNativeUpdate).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('returns 404 before updating a same-tenant foreign-org PUT target', async () => {
    const res = await PUT(
      buildMethodRequest('PUT', { displayName: 'Cross-org overwrite' }),
      { params: { id: userId } },
    )

    expect(res.status).toBe(404)
    expect(mockEmNativeUpdate).not.toHaveBeenCalled()
    expect(mockEmNativeDelete).not.toHaveBeenCalled()
    expect(mockEmCreate).not.toHaveBeenCalled()
    expect(mockEmPersist).not.toHaveBeenCalled()
    expect(mockEmFlush).not.toHaveBeenCalled()
    expect(mockInvalidateUserCache).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('returns 404 before deleting or revoking sessions for a same-tenant foreign-org DELETE target', async () => {
    const res = await DELETE(buildMethodRequest('DELETE'), { params: { id: userId } })

    expect(res.status).toBe(404)
    expect(mockSoftDelete).not.toHaveBeenCalled()
    expect(mockRevokeAllUserSessions).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })
})

describe('admin PUT /api/customer_accounts/admin/users/[id] — scoped role + company ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuth.mockResolvedValue({ sub: adminId, tenantId, orgId })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockEmCreate.mockImplementation((_entity: unknown, data: unknown) => data)
  })

  it('scopes the role lookup to tenant AND organization', async () => {
    mockEmFindOne.mockResolvedValue(targetUser)
    mockEmFind.mockImplementation(async (entity: unknown) => {
      if (entity === CustomerRole) return [{ id: roleId, name: 'Alpha' }]
      return []
    })

    const res = await PUT(buildRequest({ roleIds: [roleId] }), { params: { id: userId } })

    expect(res.status).toBe(200)
    const roleFinds = mockEmFind.mock.calls.filter((call) => call[0] === CustomerRole)
    expect(roleFinds).toHaveLength(1)
    expect(roleFinds[0][1]).toMatchObject({
      id: { $in: [roleId] },
      tenantId,
      organizationId: orgId,
      deletedAt: null,
    })
  })

  it('rejects with 400 when a requested role is out of scope', async () => {
    mockEmFindOne.mockResolvedValue(targetUser)
    mockEmFind.mockResolvedValue([])

    const res = await PUT(buildRequest({ roleIds: [roleId] }), { params: { id: userId } })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toContain(roleId)
    const roleLinkDeletes = mockEmNativeDelete.mock.calls.filter((call) => call[0] === CustomerUserRole)
    expect(roleLinkDeletes).toHaveLength(0)
  })

  it('rejects with 400 when customerEntityId is not an owned company in the caller scope', async () => {
    const foreignCompanyId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    // First findOne resolves the user; second resolves the company lookup (null = not owned).
    mockEmFindOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(null)

    const res = await PUT(buildRequest({ customerEntityId: foreignCompanyId }), { params: { id: userId } })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    const companyLookup = mockEmFindOne.mock.calls.find(
      (call) => (call[1] as any)?.id === foreignCompanyId,
    )
    expect(companyLookup).toBeDefined()
    expect(companyLookup![1]).toMatchObject({
      id: foreignCompanyId,
      tenantId,
      organizationId: orgId,
      kind: 'company',
      deletedAt: null,
    })
    // The user row is never updated when the company link is rejected.
    expect(mockEmNativeUpdate).not.toHaveBeenCalled()
  })

  it('persists customerEntityId when it is an owned company in the caller scope', async () => {
    const ownedCompanyId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    mockEmFindOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ id: ownedCompanyId, kind: 'company' })

    const res = await PUT(buildRequest({ customerEntityId: ownedCompanyId }), { params: { id: userId } })

    expect(res.status).toBe(200)
    const userUpdate = mockEmNativeUpdate.mock.calls.find(
      (call) => (call[2] as any)?.customerEntityId === ownedCompanyId,
    )
    expect(userUpdate).toBeDefined()
  })
})
