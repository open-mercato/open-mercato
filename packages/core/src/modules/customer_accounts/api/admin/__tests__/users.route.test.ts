/** @jest-environment node */
import {
  CustomerRole,
  CustomerUserRole,
} from '@open-mercato/core/modules/customer_accounts/data/entities'

const mockGetAuth = jest.fn()
const mockRbac = { userHasAllFeatures: jest.fn() }
const mockEmFind = jest.fn()
const mockEmFindAndCount = jest.fn()
const mockEmFindOne = jest.fn()
const mockEmCreate = jest.fn()
const mockEmPersist = jest.fn()
const mockEmFlush = jest.fn()
const mockEmNativeUpdate = jest.fn()
const mockFindByEmail = jest.fn()
const mockCreateUser = jest.fn()

const mockEm = {
  find: mockEmFind,
  findAndCount: mockEmFindAndCount,
  findOne: mockEmFindOne,
  create: mockEmCreate,
  persist: mockEmPersist,
  flush: mockEmFlush,
  nativeUpdate: mockEmNativeUpdate,
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return mockRbac
    if (token === 'em') return mockEm
    if (token === 'customerUserService') return {
      findByEmail: mockFindByEmail,
      createUser: mockCreateUser,
    }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuth(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: jest.fn(async () => undefined),
}))

import { GET, POST } from '@open-mercato/core/modules/customer_accounts/api/admin/users'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const adminId = '33333333-3333-4333-8333-333333333333'

const roleAlpha = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Alpha',
  slug: 'alpha',
}
const roleBeta = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Beta',
  slug: 'beta',
}

function makeUser(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@example.com`,
    displayName: `User ${id}`,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    isActive: true,
    lockedUntil: null,
    lastLoginAt: null,
    customerEntityId: null,
    personEntityId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function buildRequest(url = 'http://localhost/api/customer_accounts/admin/users', init?: RequestInit) {
  return new Request(url, init)
}

describe('admin /api/customer_accounts/admin/users — GET listing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuth.mockResolvedValue({ sub: adminId, tenantId, orgId })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
  })

  it('fetches roles in a single batched query regardless of user count (no N+1)', async () => {
    const users = ['u1', 'u2', 'u3', 'u4', 'u5'].map((id) => makeUser(id))
    mockEmFindAndCount.mockResolvedValue([users, users.length])

    const roleLinks = [
      { user: { id: 'u1' }, role: roleAlpha },
      { user: { id: 'u1' }, role: roleBeta },
      { user: { id: 'u3' }, role: roleAlpha },
      { user: { id: 'u5' }, role: roleBeta },
    ]
    mockEmFind.mockResolvedValue(roleLinks)

    const res = await GET(buildRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(5)

    const customerUserRoleCalls = mockEmFind.mock.calls.filter(
      (call) => call[0] === CustomerUserRole,
    )
    expect(customerUserRoleCalls).toHaveLength(1)
    expect(customerUserRoleCalls[0][1]).toMatchObject({
      user: { $in: ['u1', 'u2', 'u3', 'u4', 'u5'] },
      deletedAt: null,
    })

    const rolesByUser = Object.fromEntries(body.items.map((item: any) => [item.id, item.roles]))
    expect(rolesByUser.u1).toHaveLength(2)
    expect(rolesByUser.u2).toHaveLength(0)
    expect(rolesByUser.u3).toHaveLength(1)
    expect(rolesByUser.u4).toHaveLength(0)
    expect(rolesByUser.u5[0]).toMatchObject({ id: roleBeta.id, slug: 'beta' })
  })

  it('skips the CustomerUserRole query when the page is empty', async () => {
    mockEmFindAndCount.mockResolvedValue([[], 0])

    const res = await GET(buildRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toEqual([])
    const customerUserRoleCalls = mockEmFind.mock.calls.filter(
      (call) => call[0] === CustomerUserRole,
    )
    expect(customerUserRoleCalls).toHaveLength(0)
  })
})

describe('admin /api/customer_accounts/admin/users — POST role validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuth.mockResolvedValue({ sub: adminId, tenantId, orgId })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockFindByEmail.mockResolvedValue(null)
    mockCreateUser.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      email: 'new@example.com',
      displayName: 'New User',
    })
    mockEmCreate.mockImplementation((_entity: unknown, data: unknown) => data)
    mockEmFind.mockResolvedValue([])
  })

  it('validates all requested roles via a single $in query instead of per-role lookups', async () => {
    mockEmFind.mockImplementation(async (entity: unknown, where: any) => {
      if (entity === CustomerRole) {
        return [
          { id: roleAlpha.id, name: 'Alpha' },
          { id: roleBeta.id, name: 'Beta' },
        ].filter((role) => (where?.id?.$in as string[]).includes(role.id))
      }
      return []
    })

    const body = {
      email: 'new@example.com',
      password: 'Secret123!',
      displayName: 'New User',
      roleIds: [roleAlpha.id, roleBeta.id],
    }
    const req = buildRequest('http://localhost/api/customer_accounts/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockEmFindOne).not.toHaveBeenCalledWith(CustomerRole, expect.anything())
    const roleFinds = mockEmFind.mock.calls.filter((call) => call[0] === CustomerRole)
    expect(roleFinds).toHaveLength(1)
    expect(roleFinds[0][1]).toMatchObject({
      id: { $in: [roleAlpha.id, roleBeta.id] },
      tenantId,
      deletedAt: null,
    })
    // Two persists for the user-role links (one per valid role)
    const userRoleCreates = mockEmCreate.mock.calls.filter((call) => call[0] === CustomerUserRole)
    expect(userRoleCreates).toHaveLength(2)
  })
})
