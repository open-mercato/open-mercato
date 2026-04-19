/** @jest-environment node */
import { CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'

const mockGetCustomerAuth = jest.fn()
const mockRequireCustomerFeature = jest.fn()
const mockEmFind = jest.fn()
const mockEmFindAndCount = jest.fn()

const mockEm = {
  find: mockEmFind,
  findAndCount: mockEmFindAndCount,
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerRbacService') return {}
    if (token === 'em') return mockEm
    return null
  }),
}

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: jest.fn((req: Request) => mockGetCustomerAuth(req)),
  requireCustomerFeature: jest.fn((...args: unknown[]) => mockRequireCustomerFeature(...args)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

import { GET } from '@open-mercato/core/modules/customer_accounts/api/portal/users'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const customerEntityId = '33333333-3333-4333-8333-333333333333'

function makeUser(id: string) {
  return {
    id,
    email: `${id}@example.com`,
    displayName: `User ${id}`,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }
}

describe('portal /api/customer_accounts/portal/users — GET listing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCustomerAuth.mockResolvedValue({
      sub: 'user-1',
      tenantId,
      orgId,
      customerEntityId,
    })
    mockRequireCustomerFeature.mockResolvedValue(undefined)
  })

  it('applies default pagination (pageSize 25) via findAndCount and returns paging metadata', async () => {
    const users = Array.from({ length: 25 }, (_, i) => makeUser(`u${i}`))
    mockEmFindAndCount.mockResolvedValue([users, 120])
    mockEmFind.mockResolvedValue([])

    const res = await GET(new Request('http://localhost/api/customer_accounts/portal/users'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockEmFindAndCount).toHaveBeenCalledTimes(1)
    const [, _where, opts] = mockEmFindAndCount.mock.calls[0]
    expect(opts).toMatchObject({ limit: 25, offset: 0 })
    expect(body).toMatchObject({
      ok: true,
      total: 120,
      totalPages: Math.ceil(120 / 25),
      page: 1,
      pageSize: 25,
    })
    expect(body.users).toHaveLength(25)
  })

  it('respects explicit page and pageSize query params and caps pageSize at 100', async () => {
    mockEmFindAndCount.mockResolvedValue([[], 0])
    mockEmFind.mockResolvedValue([])

    const res = await GET(new Request('http://localhost/api/customer_accounts/portal/users?page=3&pageSize=500'))
    expect(res.status).toBe(200)
    const [, , opts] = mockEmFindAndCount.mock.calls[0]
    expect(opts).toMatchObject({ limit: 100, offset: 200 })
  })

  it('fetches role links in one batched $in query for the current page (no N+1)', async () => {
    const users = [makeUser('u1'), makeUser('u2'), makeUser('u3')]
    mockEmFindAndCount.mockResolvedValue([users, users.length])

    const roleLinks = [
      { user: { id: 'u1' }, role: { id: 'r1', name: 'Alpha', slug: 'alpha' } },
      { user: { id: 'u3' }, role: { id: 'r2', name: 'Beta', slug: 'beta' } },
    ]
    mockEmFind.mockResolvedValue(roleLinks)

    const res = await GET(new Request('http://localhost/api/customer_accounts/portal/users'))
    const body = await res.json()

    expect(res.status).toBe(200)
    const customerUserRoleCalls = mockEmFind.mock.calls.filter(
      (call) => call[0] === CustomerUserRole,
    )
    expect(customerUserRoleCalls).toHaveLength(1)
    expect(customerUserRoleCalls[0][1]).toMatchObject({
      user: { $in: ['u1', 'u2', 'u3'] },
      deletedAt: null,
    })
    const rolesByUser = Object.fromEntries(body.users.map((u: any) => [u.id, u.roles]))
    expect(rolesByUser.u1).toHaveLength(1)
    expect(rolesByUser.u2).toHaveLength(0)
    expect(rolesByUser.u3[0]).toMatchObject({ id: 'r2', slug: 'beta' })
  })

  it('skips the CustomerUserRole query entirely when the page is empty', async () => {
    mockEmFindAndCount.mockResolvedValue([[], 0])
    mockEmFind.mockResolvedValue([])

    const res = await GET(new Request('http://localhost/api/customer_accounts/portal/users'))
    expect(res.status).toBe(200)
    const customerUserRoleCalls = mockEmFind.mock.calls.filter(
      (call) => call[0] === CustomerUserRole,
    )
    expect(customerUserRoleCalls).toHaveLength(0)
  })
})
