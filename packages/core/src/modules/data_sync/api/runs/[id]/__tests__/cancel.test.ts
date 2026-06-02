/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()

const mockSyncRunService = {
  getRun: jest.fn(),
  markStatus: jest.fn(),
}

const mockProgressService = {
  markCancelled: jest.fn(),
  getJob: jest.fn(),
  isCancellationRequested: jest.fn(),
}

const mockIntegrationStateService = {
  upsert: jest.fn(),
}

const mockIntegrationLogService = {
  write: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(() => mockCreateRequestContainer()),
}))

type RouteModule = typeof import('../cancel')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  const routeModule = await import('../cancel')
  postHandler = routeModule.POST
})

describe('data_sync cancel run route', () => {
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
        if (token === 'progressService') return mockProgressService
        if (token === 'integrationStateService') return mockIntegrationStateService
        if (token === 'integrationLogService') return mockIntegrationLogService
        throw new Error(`Unexpected token: ${token}`)
      },
    })
    mockSyncRunService.getRun.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      integrationId: 'sync_excel',
      status: 'running',
      progressJobId: '22222222-2222-4222-8222-222222222222',
    })
    mockSyncRunService.markStatus.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', status: 'cancelled' })
    mockProgressService.markCancelled.mockResolvedValue(undefined)
    mockIntegrationStateService.upsert.mockResolvedValue(undefined)
    mockIntegrationLogService.write.mockResolvedValue(undefined)
  })

  it('returns 401 when auth is missing', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce(null)

    const response = await postHandler(new Request('http://localhost/api/data_sync/runs/1/cancel', { method: 'POST' }), {
      params: { id: '11111111-1111-4111-8111-111111111111' },
    })

    expect(response.status).toBe(401)
  })

  it('marks the run as cancelled and records operational state and logs', async () => {
    const response = await postHandler(
      new Request('http://localhost/api/data_sync/runs/11111111-1111-4111-8111-111111111111/cancel', { method: 'POST' }),
      { params: { id: '11111111-1111-4111-8111-111111111111' } },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockProgressService.markCancelled).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
    })
    expect(mockSyncRunService.markStatus).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'cancelled',
      { organizationId: 'org-1', tenantId: 'tenant-1' },
    )
    expect(mockIntegrationStateService.upsert).toHaveBeenCalledWith('sync_excel', expect.objectContaining({
      lastHealthStatus: 'degraded',
      lastHealthCheckedAt: expect.any(Date),
    }), {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
    expect(mockIntegrationLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: 'sync_excel',
      runId: '11111111-1111-4111-8111-111111111111',
      level: 'warn',
      message: 'Sync run cancelled',
      payload: expect.objectContaining({
        operationalStatus: 'cancelled',
      }),
    }), {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
  })
})
