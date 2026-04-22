/** @jest-environment node */

import { GET } from '@open-mercato/core/modules/auth/api/roles/route'

const mockGetAuthFromRequest = jest.fn()
const mockLoadAcl = jest.fn()
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

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn((args: unknown) => mockLoadCustomFieldValues(args)),
}))

const actorTenantId = '123e4567-e89b-12d3-a456-426614174003'
const requestedTenantId = '123e4567-e89b-12d3-a456-426614174004'

function makeRequest(path = '/api/auth/roles') {
  return new Request(`http://localhost${path}`, { method: 'GET' })
}

describe('GET /api/auth/roles', () => {
  beforeEach(() => {
    mockGetAuthFromRequest.mockReset()
    mockLoadAcl.mockReset()
    mockEm.find.mockReset()
    mockEm.findAndCount.mockReset()
    mockLoadCustomFieldValues.mockReset()
    mockLogCrudAccess.mockReset()
    mockContainer.resolve.mockClear()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: actorTenantId,
      orgId: '223e4567-e89b-12d3-a456-426614174003',
      roles: ['admin'],
    })
    mockLoadAcl.mockResolvedValue({ isSuperAdmin: false })
    mockEm.find.mockResolvedValue([])
    mockEm.findAndCount.mockResolvedValue([[], 0])
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
      orgId: '223e4567-e89b-12d3-a456-426614174003',
      roles: ['admin'],
    })
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: false })

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ items: [], total: 0, totalPages: 1, isSuperAdmin: false })
    expect(mockEm.findAndCount).not.toHaveBeenCalled()
  })

  test('applies tenant-scoped filters and excludes superadmin roles for non-superadmin actor', async () => {
    mockEm.find
      .mockResolvedValueOnce([{ role: { id: '323e4567-e89b-12d3-a456-426614174050' } }])
      .mockResolvedValueOnce([])
    mockEm.findAndCount.mockResolvedValueOnce([[], 0])

    await GET(makeRequest('/api/auth/roles?search=manager'))

    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }

    expect(Array.isArray(where.$and)).toBe(true)
    expect(where.$and).toEqual(expect.arrayContaining([
      { deletedAt: null },
      { name: { $ilike: '%manager%' } },
      { $or: [{ tenantId: actorTenantId }, { tenantId: null }] },
      { name: { $ne: 'superadmin' } },
      { id: { $nin: ['323e4567-e89b-12d3-a456-426614174050'] } },
    ]))
  })

  test('applies requested tenant scope for superadmin actor', async () => {
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: true })
    mockEm.findAndCount.mockResolvedValueOnce([[], 0])

    const response = await GET(makeRequest(`/api/auth/roles?tenantId=${requestedTenantId}&page=1&pageSize=20`))
    const body = await response.json()

    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }
    expect(where.$and).toEqual(expect.arrayContaining([
      { deletedAt: null },
      { $or: [{ tenantId: requestedTenantId }, { tenantId: null }] },
    ]))
    expect(where.$and).not.toEqual(expect.arrayContaining([{ name: { $ne: 'superadmin' } }]))
    expect(body.isSuperAdmin).toBe(true)
  })

  test('returns roles with usersCount and tenant visibility fields', async () => {
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: true })
    mockEm.findAndCount.mockResolvedValueOnce([
      [{ id: 'role-1', name: 'Manager', tenantId: actorTenantId }],
      1,
    ])
    mockEm.find
      .mockResolvedValueOnce([{ role: 'role-1', deletedAt: null }])
      .mockResolvedValueOnce([{ id: actorTenantId, name: 'Main Tenant' }])

    const response = await GET(makeRequest('/api/auth/roles?page=1&pageSize=10'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: 'role-1',
      name: 'Manager',
      usersCount: 1,
      tenantId: actorTenantId,
      tenantIds: [actorTenantId],
      tenantName: 'Main Tenant',
    })
  })
})
