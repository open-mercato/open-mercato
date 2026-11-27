/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockGetIntegration = jest.fn()
const mockGetDataSyncAdapter = jest.fn()
const mockStartDataSyncRun = jest.fn()

const mockSyncRunService = {
  getRun: jest.fn(),
  findRunningOverlap: jest.fn(),
  resolveCursor: jest.fn(),
}

const mockProgressService = {}

const mockIntegrationStateService = {
  isEnabled: jest.fn(),
}

const mockCrudMutationGuardService = {
  validateMutation: jest.fn(),
  afterMutationSuccess: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(() => mockCreateRequestContainer()),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegration: jest.fn((id: string) => mockGetIntegration(id)),
}))

jest.mock('../../../../lib/adapter-registry', () => ({
  getDataSyncAdapter: jest.fn((providerKey: string) => mockGetDataSyncAdapter(providerKey)),
}))

jest.mock('../../../../lib/start-cursor', () => ({
  ...jest.requireActual('../../../../lib/start-cursor'),
  resolveAdapterForIntegration: jest.fn((integrationId: string) =>
    mockGetDataSyncAdapter(mockGetIntegration(integrationId)?.providerKey ?? integrationId) ?? null),
}))

jest.mock('../../../../lib/start-run', () => ({
  startDataSyncRun: jest.fn((input) => mockStartDataSyncRun(input)),
}))

const RUN_ID = '33333333-3333-4333-8333-333333333333'

type RouteModule = typeof import('../retry')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  const routeModule = await import('../retry')
  postHandler = routeModule.POST
})

function callRetry() {
  const request = new Request(`http://localhost/api/data_sync/runs/${RUN_ID}/retry`, { method: 'POST' })
  return postHandler(request, { params: { id: RUN_ID } } as never)
}

describe('data_sync retry route — integration state', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) => {
        if (token === 'dataSyncRunService') return mockSyncRunService
        if (token === 'progressService') return mockProgressService
        if (token === 'integrationStateService') return mockIntegrationStateService
        if (token === 'crudMutationGuardService') return mockCrudMutationGuardService
        throw new Error(`Unexpected token: ${token}`)
      },
    })
    mockCrudMutationGuardService.validateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false, metadata: null })
    mockCrudMutationGuardService.afterMutationSuccess.mockResolvedValue(undefined)
    mockSyncRunService.getRun.mockResolvedValue({
      id: RUN_ID,
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      status: 'failed',
      cursor: null,
      parameters: null,
    })
    mockSyncRunService.findRunningOverlap.mockResolvedValue(null)
    mockSyncRunService.resolveCursor.mockResolvedValue(null)
    mockGetIntegration.mockReturnValue({ id: 'sync_excel', providerKey: 'excel' })
    mockGetDataSyncAdapter.mockReturnValue({
      providerKey: 'excel',
      direction: 'import',
      supportedEntities: ['customers.person'],
      runParameters: [],
    })
    mockStartDataSyncRun.mockResolvedValue({
      run: { id: '44444444-4444-4444-8444-444444444444' },
      progressJob: null,
    })
  })

  it.each(['failed', 'cancelled'])('refuses to retry a %s run while its integration is disabled', async (status) => {
    mockSyncRunService.getRun.mockResolvedValue({
      id: RUN_ID,
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      status,
      cursor: null,
      parameters: null,
    })
    mockIntegrationStateService.isEnabled.mockResolvedValue(false)

    const response = await callRetry()

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Integration is disabled', code: 'integrationDisabled' })
    expect(mockIntegrationStateService.isEnabled).toHaveBeenCalledWith('sync_excel', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
    expect(mockSyncRunService.findRunningOverlap).not.toHaveBeenCalled()
    expect(mockStartDataSyncRun).not.toHaveBeenCalled()
    expect(mockCrudMutationGuardService.validateMutation).not.toHaveBeenCalled()
  })

  it('still retries a failed run while its integration is enabled', async () => {
    mockIntegrationStateService.isEnabled.mockResolvedValue(true)

    const response = await callRetry()

    expect(response.status).toBe(201)
    expect(mockStartDataSyncRun).toHaveBeenCalledTimes(1)
  })
})
