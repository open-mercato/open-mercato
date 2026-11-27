const mockFindAndCount = jest.fn()
const mockFindOne = jest.fn()
const mockResolveScope = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'user', tenantId: 'home-tenant', orgId: 'home-org' }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: () => ({ findAndCount: mockFindAndCount, findOne: mockFindOne }),
  }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: () => mockResolveScope(),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: () => ({}),
}))

const routeLoaders = {
  'account-groups': () => import('../account-groups/route'),
  'account-types': () => import('../account-types/route'),
  accounts: () => import('../accounts/route'),
  'fiscal-periods': () => import('../fiscal-periods/route'),
  'journal-entries': () => import('../journal-entries/route'),
}

const DETAIL_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  jest.resetAllMocks()
  mockFindAndCount.mockResolvedValue([[], 0])
})

describe.each(Object.entries(routeLoaders))('ledger %s read scope', (route, loadRoute) => {
  it.each(['', `?id=${DETAIL_ID}`])('uses the resolved tenant and every allowed organization for %s', async (query) => {
    mockResolveScope.mockResolvedValue({
      selectedId: null,
      tenantId: 'resolved-tenant',
      filterIds: ['allowed-org', 'allowed-descendant'],
    })
    const { GET } = await loadRoute()

    const response = await GET(new Request(`http://localhost/api/ledger/${route}${query}`))

    expect(response.status).toBe(200)
    expect(mockFindAndCount).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: 'resolved-tenant',
      organizationId: { $in: ['allowed-org', 'allowed-descendant'] },
      ...(query ? { id: DETAIL_ID } : {}),
    }), expect.anything())
  })

  it('returns an empty page without querying when authorization narrows to no organizations', async () => {
    mockResolveScope.mockResolvedValue({ tenantId: 'resolved-tenant', filterIds: [] })
    const { GET } = await loadRoute()

    const response = await GET(new Request(`http://localhost/api/ledger/${route}?page=2&pageSize=5`))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [], total: 0, page: 2, pageSize: 5, totalPages: 1 })
    expect(mockFindAndCount).not.toHaveBeenCalled()
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it('allows tenant-wide reads only when the resolved scope is unrestricted', async () => {
    mockResolveScope.mockResolvedValue({ tenantId: 'resolved-tenant', filterIds: null })
    const { GET } = await loadRoute()

    await GET(new Request(`http://localhost/api/ledger/${route}`))

    const [, where] = mockFindAndCount.mock.calls[0]
    expect(where).toHaveProperty('tenantId', 'resolved-tenant')
    expect(where).not.toHaveProperty('organizationId')
  })
})

it('looks up a journal filter period only within the resolved tenant and authorized organizations', async () => {
  mockResolveScope.mockResolvedValue({ tenantId: 'resolved-tenant', filterIds: ['allowed-org'] })
  mockFindOne.mockResolvedValue(null)
  const { GET } = await routeLoaders['journal-entries']()

  const response = await GET(new Request(`http://localhost/api/ledger/journal-entries?periodId=${DETAIL_ID}`))

  expect(response.status).toBe(200)
  expect(mockFindOne).toHaveBeenCalledWith(expect.anything(), {
    id: DETAIL_ID,
    tenantId: 'resolved-tenant',
    organizationId: { $in: ['allowed-org'] },
    deletedAt: null,
  })
  expect(mockFindAndCount).not.toHaveBeenCalled()
})
