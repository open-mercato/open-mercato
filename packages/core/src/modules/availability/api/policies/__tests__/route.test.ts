/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockFindAndCountWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return {}
      throw new Error(`[internal] unexpected resolve(${token})`)
    },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((...args: unknown[]) => mockResolveOrganizationScope(...args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: jest.fn((...args: unknown[]) => mockFindAndCountWithDecryption(...args)),
}))

type RouteModule = typeof import('../route')
let listHandler: RouteModule['GET']
let previewHandler: typeof import('../resolve-preview/route')['GET']
let checkHandler: typeof import('../../check/route')['POST']

beforeAll(async () => {
  listHandler = (await import('../route')).GET
  previewHandler = (await import('../resolve-preview/route')).GET
  checkHandler = (await import('../../check/route')).POST
})

describe('availability read routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockResolveOrganizationScope.mockResolvedValue({ selectedId: 'org-1', filterIds: ['org-1'], tenantId: 'tenant-1' })
    mockFindAndCountWithDecryption.mockResolvedValue([[], 0])
  })

  it.each([
    ['policies', 'GET', (request: Request) => listHandler(request)],
    ['policies/resolve-preview', 'GET', (request: Request) => previewHandler(request)],
    ['check', 'POST', (request: Request) => checkHandler(request)],
  ] as const)('rejects an invalid organization selection for /%s', async (path, method, handler) => {
    mockResolveOrganizationScope.mockResolvedValue({
      tenantId: 'tenant-1', selectedId: null, filterIds: ['org-1'], selectionRejected: true,
    })

    const response = await handler(new Request(`http://localhost/api/availability/${path}`, { method }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ code: 'organization_selection_invalid' })
    expect(mockFindAndCountWithDecryption).not.toHaveBeenCalled()
  })

  it.each([
    ['', { createdAt: 'DESC', id: 'DESC' }],
    ['?sortDir=asc', { createdAt: 'ASC', id: 'ASC' }],
    ['?sortField=createdAt&sortDir=desc', { createdAt: 'DESC', id: 'DESC' }],
    ['?sortField=updatedAt&sortDir=desc', { updatedAt: 'DESC', id: 'DESC' }],
    ['?sortField=updatedAt&sortDir=asc', { updatedAt: 'ASC', id: 'ASC' }],
  ])('breaks sort ties by id so offset pages stay stable (%s)', async (query, expectedOrderBy) => {
    const response = await listHandler(new Request(`http://localhost/api/availability/policies${query}`))

    expect(response.status).toBe(200)
    const options = mockFindAndCountWithDecryption.mock.calls[0][3] as { orderBy: Record<string, 'ASC' | 'DESC'> }
    expect(options.orderBy).toEqual(expectedOrderBy)
    expect(Object.keys(options.orderBy)).toEqual(Object.keys(expectedOrderBy))
  })
})
