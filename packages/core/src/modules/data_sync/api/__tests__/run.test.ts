/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockGetIntegration = jest.fn()
const mockGetDataSyncAdapter = jest.fn()
const mockStartDataSyncRun = jest.fn()

const mockSyncRunService = {
  findRunningOverlap: jest.fn(),
  resolveCursor: jest.fn(),
}

const mockProgressService = {}

const mockIntegrationStateService = {
  isEnabled: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(() => mockCreateRequestContainer()),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn((request: Request) => request.json()),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegration: jest.fn((id: string) => mockGetIntegration(id)),
}))

jest.mock('../../lib/adapter-registry', () => ({
  getDataSyncAdapter: jest.fn((providerKey: string) => mockGetDataSyncAdapter(providerKey)),
}))

jest.mock('../../lib/start-run', () => ({
  startDataSyncRun: jest.fn((input) => mockStartDataSyncRun(input)),
}))

type RouteModule = typeof import('../run')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  const routeModule = await import('../run')
  postHandler = routeModule.POST
})

describe('data_sync run route', () => {
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
        throw new Error(`Unexpected token: ${token}`)
      },
    })
    mockGetIntegration.mockReturnValue({
      id: 'sync_excel',
      providerKey: 'excel',
    })
    mockGetDataSyncAdapter.mockReturnValue({
      providerKey: 'excel',
      runMode: 'generic',
      direction: 'import',
      supportedEntities: ['customers.person'],
    })
    mockIntegrationStateService.isEnabled.mockResolvedValue(true)
    mockSyncRunService.findRunningOverlap.mockResolvedValue(null)
    mockSyncRunService.resolveCursor.mockResolvedValue(null)
    mockStartDataSyncRun.mockResolvedValue({
      run: { id: '11111111-1111-4111-8111-111111111111' },
      progressJob: { id: '22222222-2222-4222-8222-222222222222' },
    })
  })

  it('returns a controlled 422 for provider-managed adapters', async () => {
    mockGetDataSyncAdapter.mockReturnValueOnce({
      providerKey: 'excel',
      runMode: 'provider',
      direction: 'import',
      supportedEntities: ['customers.person'],
    })

    const response = await postHandler(new Request('http://localhost/api/data_sync/run', {
      method: 'POST',
      body: JSON.stringify({
        integrationId: 'sync_excel',
        entityType: 'customers.person',
        direction: 'import',
      }),
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'This integration must be started from its provider-specific import flow.',
      settingsPath: '/backend/integrations/sync_excel',
    })
    expect(mockStartDataSyncRun).not.toHaveBeenCalled()
  })

  it('starts generic adapters normally', async () => {
    const response = await postHandler(new Request('http://localhost/api/data_sync/run', {
      method: 'POST',
      body: JSON.stringify({
        integrationId: 'generic_sync',
        entityType: 'customers.person',
        direction: 'import',
        batchSize: 10,
      }),
    }))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      progressJobId: '22222222-2222-4222-8222-222222222222',
    })
    expect(mockStartDataSyncRun).toHaveBeenCalled()
  })
})
