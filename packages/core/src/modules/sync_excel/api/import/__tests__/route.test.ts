/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockReadJsonSafe = jest.fn()
const mockStartDataSyncRun = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockResolveSyncExcelConcreteScope = jest.fn()

const mockUpload = {
  id: '11111111-1111-4111-8111-111111111111',
  attachmentId: '66666666-6666-4666-8666-666666666666',
  filename: 'Leads.csv',
  entityType: 'customers.person',
  status: 'uploaded',
  syncRunId: null as string | null,
}

const mockExistingMapping = {
  mapping: {},
}

const mockEm = {
  findOne: jest.fn(),
  create: jest.fn((Entity: unknown, data: Record<string, unknown>) => ({ __entity: Entity, ...data })),
  persist: jest.fn(),
  flush: jest.fn(async () => undefined),
}

const mockSyncRunService = {
  findRunningOverlap: jest.fn(async () => null),
}

const mockProgressService = {}

const mockCredentialsService = {
  save: jest.fn(async () => undefined),
}

const mockIntegrationStateService = {
  upsert: jest.fn(async () => undefined),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'dataSyncRunService') return mockSyncRunService
    if (token === 'progressService') return mockProgressService
    if (token === 'integrationCredentialsService') return mockCredentialsService
    if (token === 'integrationStateService') return mockIntegrationStateService
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn((request: Request) => mockReadJsonSafe(request)),
}))

jest.mock('@open-mercato/core/modules/data_sync/lib/start-run', () => ({
  startDataSyncRun: jest.fn((params: unknown) => mockStartDataSyncRun(params)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('../../../lib/scope', () => ({
  resolveSyncExcelConcreteScope: jest.fn((params: unknown) => mockResolveSyncExcelConcreteScope(params)),
}))

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  const routeModule = await import('../route')
  postHandler = routeModule.POST
})

describe('sync_excel import route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpload.status = 'uploaded'
    mockUpload.syncRunId = null
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
    })
    mockReadJsonSafe.mockResolvedValue({
      uploadId: mockUpload.id,
      entityType: 'customers.person',
      batchSize: 50,
      mapping: {
        entityType: 'customers.person',
        matchStrategy: 'externalId',
        matchField: 'person.externalId',
        fields: [
          { externalField: 'Record Id', localField: 'person.externalId', mappingKind: 'external_id' },
          { externalField: 'First Name', localField: 'person.firstName', mappingKind: 'core' },
          { externalField: 'Last Name', localField: 'person.lastName', mappingKind: 'core' },
        ],
        unmappedColumns: ['Unused'],
      },
    })
    mockResolveSyncExcelConcreteScope.mockResolvedValue({
      ok: true,
      scope: {
        organizationId: '33333333-3333-4333-8333-333333333333',
        tenantId: '22222222-2222-4222-8222-222222222222',
      },
    })
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, criteria: Record<string, unknown>) => {
      if (criteria?.id === mockUpload.id) return mockUpload
      if (criteria?.id === mockUpload.attachmentId) {
        return {
          id: mockUpload.attachmentId,
          partitionCode: 'privateAttachments',
          storagePath: 'org/org/Leads.csv',
          storageDriver: 'local',
        }
      }
      if (criteria?.integrationId === 'sync_excel' && criteria?.entityType === 'customers.person') {
        return mockExistingMapping
      }
      return null
    })
    mockStartDataSyncRun.mockResolvedValue({
      run: {
        id: '44444444-4444-4444-8444-444444444444',
        status: 'pending',
      },
      progressJob: {
        id: '55555555-5555-4555-8555-555555555555',
      },
    })
  })

  it('returns 401 when auth is missing', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce(null)

    const response = await postHandler(new Request('http://localhost/api/sync_excel/import', { method: 'POST' }))

    expect(response.status).toBe(401)
  })

  it('starts a sync run, persists mapping, and updates the upload status', async () => {
    const response = await postHandler(new Request('http://localhost/api/sync_excel/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      runId: '44444444-4444-4444-8444-444444444444',
      progressJobId: '55555555-5555-4555-8555-555555555555',
      status: 'pending',
    })

    expect(mockExistingMapping.mapping).toMatchObject({
      entityType: 'customers.person',
      matchStrategy: 'externalId',
    })
    expect(mockCredentialsService.save).toHaveBeenCalledWith('sync_excel', {}, {
      organizationId: '33333333-3333-4333-8333-333333333333',
      tenantId: '22222222-2222-4222-8222-222222222222',
    })
    expect(mockIntegrationStateService.upsert).toHaveBeenCalledWith('sync_excel', { isEnabled: true }, {
      organizationId: '33333333-3333-4333-8333-333333333333',
      tenantId: '22222222-2222-4222-8222-222222222222',
    })
    expect(mockStartDataSyncRun).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        integrationId: 'sync_excel',
        entityType: 'customers.person',
        direction: 'import',
        batchSize: 50,
        cursor: expect.stringContaining(`"uploadId":"${mockUpload.id}"`),
      }),
    }))
    expect(JSON.parse(mockStartDataSyncRun.mock.calls[0][0].input.cursor)).toEqual({
      uploadId: mockUpload.id,
      offset: 0,
    })
    expect(mockUpload.syncRunId).toBe('44444444-4444-4444-8444-444444444444')
    expect(mockUpload.status).toBe('importing')
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('returns 422 when All organizations is selected', async () => {
    mockResolveSyncExcelConcreteScope.mockResolvedValueOnce({
      ok: false,
      status: 422,
      error: 'Select a concrete organization before importing CSV.',
    })

    const response = await postHandler(new Request('http://localhost/api/sync_excel/import', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'om_selected_org=__all__',
      },
      body: JSON.stringify({ ok: true }),
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'Select a concrete organization before importing CSV.' })
  })

  it('returns 404 when upload is missing', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const response = await postHandler(new Request('http://localhost/api/sync_excel/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(404)
  })
})
