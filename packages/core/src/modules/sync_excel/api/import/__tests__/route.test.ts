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

const transactionEvents: string[] = []
const mockInvalidateCredentialsMap = jest.fn(async () => {
  transactionEvents.push('invalidate')
})

const mockEm = {
  findOne: jest.fn(),
  create: jest.fn((Entity: unknown, data: Record<string, unknown>) => ({ __entity: Entity, ...data })),
  persist: jest.fn(),
  flush: jest.fn(async () => undefined),
  transactional: jest.fn(async (work: (tx: unknown) => unknown) => {
    transactionEvents.push('begin')
    try {
      const result = await work(mockEm)
      await mockEm.flush()
      transactionEvents.push('commit')
      return result
    } catch (error) {
      transactionEvents.push('rollback')
      throw error
    }
  }),
}

const mockSyncRunService = {
  findRunningOverlap: jest.fn(async () => null),
}

const mockProgressService = {}

const mockCredentialsService = {
  save: jest.fn(async (
    _integrationId: string,
    _credentials: Record<string, unknown>,
    _scope: Record<string, unknown>,
    options?: { deferAfterCommit?: (callback: () => void | Promise<void>) => void },
  ) => {
    options?.deferAfterCommit?.(mockInvalidateCredentialsMap)
  }),
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

const mockRunRouteMutationGuards = jest.fn()
const mockRunAfterSuccess = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn((params: unknown) => mockRunRouteMutationGuards(params)),
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
    transactionEvents.length = 0
    mockIntegrationStateService.upsert.mockResolvedValue(undefined)
    mockUpload.status = 'uploaded'
    mockUpload.syncRunId = null
    mockRunRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: mockRunAfterSuccess })
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
    expect(mockCredentialsService.save).toHaveBeenCalledWith(
      'sync_excel',
      {},
      {
        organizationId: '33333333-3333-4333-8333-333333333333',
        tenantId: '22222222-2222-4222-8222-222222222222',
      },
      { deferAfterCommit: expect.any(Function) },
    )
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
    expect(mockInvalidateCredentialsMap).toHaveBeenCalledTimes(1)
    expect(transactionEvents.slice(0, 3)).toEqual(['begin', 'commit', 'invalidate'])
  })

  it('suppresses deferred encryption-map invalidation when the outer transaction rolls back', async () => {
    mockIntegrationStateService.upsert.mockRejectedValueOnce(new Error('state write failed'))

    const response = await postHandler(new Request('http://localhost/api/sync_excel/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }))

    expect(response.status).toBe(500)
    expect(mockCredentialsService.save).toHaveBeenCalledWith(
      'sync_excel',
      {},
      expect.objectContaining({
        organizationId: '33333333-3333-4333-8333-333333333333',
        tenantId: '22222222-2222-4222-8222-222222222222',
      }),
      { deferAfterCommit: expect.any(Function) },
    )
    expect(transactionEvents).toEqual(['begin', 'rollback'])
    expect(mockInvalidateCredentialsMap).not.toHaveBeenCalled()
    expect(mockStartDataSyncRun).not.toHaveBeenCalled()
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

  it('does not leak the error message or stack in the 500 response (CWE-209)', async () => {
    const internalDetail = '/srv/app/internal at sync_runs_pkey; connection tenant_secret'
    mockStartDataSyncRun.mockRejectedValueOnce(new Error(internalDetail))

    const response = await postHandler(new Request('http://localhost/api/sync_excel/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: 'Failed to start sync_excel import.' })
    expect(JSON.stringify(body)).not.toContain(internalDetail)
  })

  it('blocks the import before persisting mapping or starting a run when a mutation guard rejects it', async () => {
    mockRunRouteMutationGuards.mockResolvedValueOnce({
      ok: false,
      errorStatus: 423,
      errorBody: { error: 'Record locked' },
      response: Response.json({ error: 'Record locked' }, { status: 423 }),
    })

    const response = await postHandler(new Request('http://localhost/api/sync_excel/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }))

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual({ error: 'Record locked' })
    expect(mockEm.transactional).not.toHaveBeenCalled()
    expect(mockCredentialsService.save).not.toHaveBeenCalled()
    expect(mockIntegrationStateService.upsert).not.toHaveBeenCalled()
    expect(mockStartDataSyncRun).not.toHaveBeenCalled()
    expect(mockUpload.status).toBe('uploaded')
    expect(mockRunAfterSuccess).not.toHaveBeenCalled()
  })

  it('runs the mutation guard as an update on the upload and its after-success hook once the run started', async () => {
    const response = await postHandler(new Request('http://localhost/api/sync_excel/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }))

    expect(response.status).toBe(201)
    expect(mockRunRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
      container: mockContainer,
      auth: {
        userId: 'user-1',
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
      },
      input: expect.objectContaining({
        resourceKind: 'sync_excel.upload',
        resourceId: mockUpload.id,
        operation: 'update',
        mutationPayload: expect.objectContaining({ uploadId: mockUpload.id, entityType: 'customers.person' }),
      }),
    }))
    expect(mockRunAfterSuccess).toHaveBeenCalledTimes(1)
    expect(mockStartDataSyncRun.mock.invocationCallOrder[0]).toBeLessThan(mockRunAfterSuccess.mock.invocationCallOrder[0])
  })

  it('applies a guard-modified payload to the import', async () => {
    mockRunRouteMutationGuards.mockResolvedValueOnce({
      ok: true,
      modifiedPayload: { batchSize: 10 },
      runAfterSuccess: mockRunAfterSuccess,
    })

    const response = await postHandler(new Request('http://localhost/api/sync_excel/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }))

    expect(response.status).toBe(201)
    expect(mockStartDataSyncRun).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ batchSize: 10 }),
    }))
  })
})
