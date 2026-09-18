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

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegration: jest.fn((id: string) => mockGetIntegration(id)),
}))

jest.mock('../../../../lib/adapter-registry', () => ({
  getDataSyncAdapter: jest.fn((providerKey: string) => mockGetDataSyncAdapter(providerKey)),
}))

// The route resolves the adapter through `start-cursor`, which re-exports the
// registry helper — the same one the cursor resolution uses, so both decisions
// agree on one adapter per integration.
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

function buildRequest() {
  return new Request(`http://localhost/api/data_sync/runs/${RUN_ID}/retry`, { method: 'POST' })
}

function callRetry() {
  return postHandler(buildRequest(), { params: { id: RUN_ID } } as never)
}

describe('data_sync retry route — run parameters', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) => {
        if (token === 'dataSyncRunService') return mockSyncRunService
        if (token === 'progressService') return mockProgressService
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
      parameters: { startId: 900123, dryRun: true },
    })
    mockSyncRunService.findRunningOverlap.mockResolvedValue(null)
    mockSyncRunService.resolveCursor.mockResolvedValue(null)
    mockGetIntegration.mockReturnValue({ id: 'sync_excel', providerKey: 'excel' })
    mockStartDataSyncRun.mockResolvedValue({
      run: { id: '44444444-4444-4444-8444-444444444444' },
      progressJob: null,
    })
  })

  it('replays stored parameters that are still valid', async () => {
    mockGetDataSyncAdapter.mockReturnValue({
      providerKey: 'excel',
      direction: 'import',
      supportedEntities: ['customers.person'],
      runParameters: [
        { key: 'startId', label: 'Start id', type: 'number', min: 0 },
        { key: 'dryRun', label: 'Dry run', type: 'boolean' },
      ],
    })

    const response = await callRetry()

    expect(response.status).toBe(201)
    expect(mockStartDataSyncRun).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ parameters: { startId: 900123, dryRun: true } }),
    }))
  })

  it('drops a parameter the adapter no longer declares', async () => {
    mockGetDataSyncAdapter.mockReturnValue({
      providerKey: 'excel',
      direction: 'import',
      supportedEntities: ['customers.person'],
      runParameters: [{ key: 'dryRun', label: 'Dry run', type: 'boolean' }],
    })

    const response = await callRetry()

    expect(response.status).toBe(201)
    expect(mockStartDataSyncRun).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ parameters: { dryRun: true } }),
    }))
  })

  it('refuses the retry when a stored value no longer satisfies the declaration', async () => {
    // The bound tightened between the original run and now.
    mockGetDataSyncAdapter.mockReturnValue({
      providerKey: 'excel',
      direction: 'import',
      supportedEntities: ['customers.person'],
      runParameters: [
        { key: 'startId', label: 'Start id', type: 'number', min: 1_000_000 },
        { key: 'dryRun', label: 'Dry run', type: 'boolean' },
      ],
    })

    const response = await callRetry()

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.details.parameters).toEqual([
      expect.objectContaining({ key: 'startId', code: 'min' }),
    ])
    expect(mockStartDataSyncRun).not.toHaveBeenCalled()
  })

  it('drops a parameter that is now scoped to a different entity', async () => {
    mockGetDataSyncAdapter.mockReturnValue({
      providerKey: 'excel',
      direction: 'import',
      supportedEntities: ['customers.person', 'orders'],
      runParameters: [
        { key: 'startId', label: 'Start id', type: 'number', min: 0, entityType: 'orders' },
        { key: 'dryRun', label: 'Dry run', type: 'boolean' },
      ],
    })

    const response = await callRetry()

    expect(response.status).toBe(201)
    expect(mockStartDataSyncRun).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ parameters: { dryRun: true } }),
    }))
  })

  it('passes null when the adapter declares nothing at all', async () => {
    mockGetDataSyncAdapter.mockReturnValue({
      providerKey: 'excel',
      direction: 'import',
      supportedEntities: ['customers.person'],
    })

    const response = await callRetry()

    expect(response.status).toBe(201)
    expect(mockStartDataSyncRun).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ parameters: null }),
    }))
  })
})
