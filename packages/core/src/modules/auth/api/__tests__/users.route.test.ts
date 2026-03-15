/** @jest-environment node */

import { GET } from '@open-mercato/core/modules/auth/api/users/route'

const mockGetAuthFromRequest = jest.fn()
const mockLoadAcl = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockLoadCustomFieldValues = jest.fn()
const mockLogCrudAccess = jest.fn()

const mockEm = {
  find: jest.fn(),
  findAndCount: jest.fn(),
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

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: { metadata: unknown }) => ({
    metadata: opts.metadata,
    POST: jest.fn(),
    PUT: jest.fn(),
    DELETE: jest.fn(),
  })),
  logCrudAccess: jest.fn((args: unknown) => mockLogCrudAccess(args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
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
    mockEm.findAndCount.mockReset()
    mockFindWithDecryption.mockReset()
    mockLoadCustomFieldValues.mockReset()
    mockLogCrudAccess.mockReset()
    mockContainer.resolve.mockClear()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId,
      orgId: organizationId,
      isSuperAdmin: false,
      roles: ['admin'],
    })
    mockLoadAcl.mockResolvedValue({ isSuperAdmin: false })
    mockEm.find.mockResolvedValue([])
    mockEm.findAndCount.mockResolvedValue([[], 0])
    mockFindWithDecryption.mockResolvedValue([])
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

  test('applies tenant and search filters for non-superadmin users', async () => {
    mockEm.findAndCount.mockResolvedValueOnce([
      [
        {
          id: '423e4567-e89b-12d3-a456-426614174001',
          email: 'alice@example.com',
          tenantId,
          organizationId,
        },
      ],
      1,
    ])

    const response = await GET(makeRequest('/api/auth/users?search=alice&page=1&pageSize=50'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deletedAt: null,
        tenantId,
        email: { $ilike: '%alice%' },
      }),
      expect.objectContaining({
        limit: 50,
        offset: 0,
      }),
    )
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      email: 'alice@example.com',
      tenantId,
      organizationId,
    })
    expect(body.isSuperAdmin).toBe(false)
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

    const where = mockEm.findAndCount.mock.calls[0][1] as { id?: { $in: string[] } }
    expect(where.id?.$in).toEqual([matchedUserId])
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

    const where = mockEm.findAndCount.mock.calls[0][1] as { id?: { $in: string[] } }
    expect(where.id?.$in).toEqual(expect.arrayContaining([firstUserId, secondUserId]))
    expect(where.id?.$in).toHaveLength(2)
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

    const where = mockEm.findAndCount.mock.calls[0][1] as Record<string, unknown>
    expect(where.organizationId).toBe(secondaryOrganizationId)
    expect(where).not.toHaveProperty('tenantId')
    expect(body.isSuperAdmin).toBe(true)
  })
})
