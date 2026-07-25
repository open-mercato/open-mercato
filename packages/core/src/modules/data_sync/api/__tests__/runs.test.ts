/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()

const mockSyncRunService = {
  listRuns: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(() => mockCreateRequestContainer()),
}))

type RouteModule = typeof import('../runs')
let getHandler: RouteModule['GET']

beforeAll(async () => {
  const routeModule = await import('../runs')
  getHandler = routeModule.GET
})

describe('data_sync runs route (issue #3215)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) => {
        if (token === 'dataSyncRunService') return mockSyncRunService
        throw new Error(`Unexpected token: ${token}`)
      },
    })
    mockSyncRunService.listRuns.mockResolvedValue({ items: [], total: 0 })
  })

  it('forwards the search query to the run service', async () => {
    await getHandler(new Request('http://localhost/api/data_sync/runs?search=excel'))

    expect(mockSyncRunService.listRuns).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'excel', page: 1, pageSize: 20 }),
      { organizationId: 'org-1', tenantId: 'tenant-1' },
    )
  })

  it('trims surrounding whitespace from the search query', async () => {
    await getHandler(new Request('http://localhost/api/data_sync/runs?search=%20%20widgets%20%20'))

    expect(mockSyncRunService.listRuns).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'widgets' }),
      expect.anything(),
    )
  })

  it('omits search when not provided', async () => {
    await getHandler(new Request('http://localhost/api/data_sync/runs?page=2'))

    const [query] = mockSyncRunService.listRuns.mock.calls[0]
    expect(query.search).toBeUndefined()
    expect(query.page).toBe(2)
  })

  it('rejects an over-long search term with a 400', async () => {
    const longTerm = 'a'.repeat(201)
    const response = await getHandler(
      new Request(`http://localhost/api/data_sync/runs?search=${longTerm}`),
    )

    expect(response.status).toBe(400)
    expect(mockSyncRunService.listRuns).not.toHaveBeenCalled()
  })
})
