/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockResolveAvailabilityListOrganizationIds = jest.fn()
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

jest.mock('../../../lib/organizationScope', () => ({
  resolveAvailabilityListOrganizationIds: jest.fn((...args: unknown[]) => mockResolveAvailabilityListOrganizationIds(...args)),
  scopeAvailabilityPolicyWriteInput: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: jest.fn((...args: unknown[]) => mockFindAndCountWithDecryption(...args)),
}))

type RouteModule = typeof import('../route')
let listHandler: RouteModule['GET']

beforeAll(async () => {
  listHandler = (await import('../route')).GET
})

describe('availability policies list route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockResolveAvailabilityListOrganizationIds.mockResolvedValue(['org-1'])
    mockFindAndCountWithDecryption.mockResolvedValue([[], 0])
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
