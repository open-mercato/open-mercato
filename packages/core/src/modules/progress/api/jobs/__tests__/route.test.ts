/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockCreateJob = jest.fn()
const mockResolveForRequest = jest.fn()
const mockFindAndCount = jest.fn()
const mockGetJob = jest.fn()
const mockUpdateProgress = jest.fn()
const mockCancelJob = jest.fn()
const mockGetActiveJobs = jest.fn()
const mockGetRecentlyCompletedJobs = jest.fn()
const mockMarkStaleJobsFailed = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(() => mockCreateRequestContainer()),
}))

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']
let listHandler: RouteModule['GET']
let activeHandler: typeof import('../../active/route')['GET']
let detailGetHandler: typeof import('../[id]/route')['GET']
let detailPutHandler: typeof import('../[id]/route')['PUT']
let detailDeleteHandler: typeof import('../[id]/route')['DELETE']
let metadata: RouteModule['metadata']
let activeMetadata: typeof import('../../active/route')['metadata']
let detailMetadata: typeof import('../[id]/route')['metadata']

beforeAll(async () => {
  const routeModule = await import('../route')
  const activeRouteModule = await import('../../active/route')
  const detailRouteModule = await import('../[id]/route')
  postHandler = routeModule.POST
  listHandler = routeModule.GET
  activeHandler = activeRouteModule.GET
  detailGetHandler = detailRouteModule.GET
  detailPutHandler = detailRouteModule.PUT
  detailDeleteHandler = detailRouteModule.DELETE
  metadata = routeModule.metadata
  activeMetadata = activeRouteModule.metadata
  detailMetadata = detailRouteModule.metadata
})

describe('progress jobs route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) => {
        if (token === 'em') return { findAndCount: mockFindAndCount }
        if (token === 'organizationScopeService') return { resolveForRequest: mockResolveForRequest }
        if (token === 'progressService') {
          return {
            createJob: mockCreateJob,
            getJob: mockGetJob,
            updateProgress: mockUpdateProgress,
            cancelJob: mockCancelJob,
            getActiveJobs: mockGetActiveJobs,
            getRecentlyCompletedJobs: mockGetRecentlyCompletedJobs,
            markStaleJobsFailed: mockMarkStaleJobsFailed,
          }
        }
        throw new Error(`Unexpected token: ${token}`)
      },
    })
    mockResolveForRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: ['org-1'],
    })
    mockFindAndCount.mockResolvedValue([[], 0])
    mockCreateJob.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mockGetJob.mockResolvedValue(null)
    mockUpdateProgress.mockResolvedValue({ progressPercent: 25 })
    mockCancelJob.mockResolvedValue({ id: 'job-1' })
    mockGetActiveJobs.mockResolvedValue([])
    mockGetRecentlyCompletedJobs.mockResolvedValue([])
    mockMarkStaleJobsFailed.mockResolvedValue(0)
  })

  it('requires progress.view for progress read routes', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['progress.view'] })
    expect(activeMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['progress.view'] })
    expect(detailMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['progress.view'] })
  })

  it('keeps mutating progress routes on their action-specific features', () => {
    expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['progress.create'] })
    expect(detailMetadata.PUT).toEqual({ requireAuth: true, requireFeatures: ['progress.update'] })
    expect(detailMetadata.DELETE).toEqual({ requireAuth: true, requireFeatures: ['progress.cancel'] })
  })

  it('creates a progress job', async () => {
    const response = await postHandler(new Request('http://localhost/api/progress/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobType: 'export', name: 'Export job' }),
    }))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ id: '11111111-1111-4111-8111-111111111111' })
    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'export' }),
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        organizationIds: ['org-1'],
        userId: 'user-1',
      },
    )
  })

  it('pins and normalizes the authenticated tenant for request scope resolution', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: ' tenant-1 ',
      orgId: 'org-1',
    })
    mockResolveForRequest.mockResolvedValue({
      tenantId: ' tenant-1 ',
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: ['org-1'],
    })

    const response = await listHandler(new Request('http://localhost/api/progress/jobs'))

    expect(response.status).toBe(200)
    expect(mockResolveForRequest).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1' }))
    expect(mockFindAndCount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.anything(),
    )
  })

  it('keeps an orgless non-superadmin inside the finite scope resolved for the request', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: null,
      isSuperAdmin: false,
    })
    mockResolveForRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: 'org-2',
      filterIds: ['org-2', 'org-2-child'],
      allowedIds: ['org-2', 'org-2-child'],
    })

    const response = await listHandler(new Request('http://localhost/api/progress/jobs'))

    expect(response.status).toBe(200)
    expect(mockFindAndCount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: { $in: ['org-2', 'org-2-child'] },
      }),
      expect.anything(),
    )
  })

  it('rejects tenant-wide creation for finite orgless access without a selected organization', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: null,
      isSuperAdmin: false,
    })
    mockResolveForRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: null,
      filterIds: ['org-1', 'org-2'],
      allowedIds: ['org-1', 'org-2'],
    })

    const response = await postHandler(new Request('http://localhost/api/progress/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobType: 'export', name: 'Export job' }),
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockCreateJob).not.toHaveBeenCalled()
  })

  it('preserves canonical superadmin creation without an organization target', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'superadmin-1',
      tenantId: 'tenant-1',
      orgId: null,
      isSuperAdmin: true,
    })
    mockResolveForRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: null,
      filterIds: null,
      allowedIds: null,
    })

    const response = await postHandler(new Request('http://localhost/api/progress/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobType: 'maintenance', name: 'Tenant maintenance' }),
    }))

    expect(response.status).toBe(201)
    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'maintenance' }),
      {
        tenantId: 'tenant-1',
        organizationId: null,
        organizationIds: null,
        userId: 'superadmin-1',
      },
    )
  })

  it('returns an empty list for an explicit finite deny-all scope', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: null,
      isSuperAdmin: false,
    })
    mockResolveForRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: null,
      filterIds: [],
      allowedIds: [],
    })

    const response = await listHandler(new Request('http://localhost/api/progress/jobs'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    })
    expect(mockFindAndCount).not.toHaveBeenCalled()
  })

  it('re-resolves organization access on a fresh request after revocation', async () => {
    mockResolveForRequest
      .mockResolvedValueOnce({
        tenantId: 'tenant-1',
        selectedId: 'org-1',
        filterIds: ['org-1'],
        allowedIds: ['org-1'],
      })
      .mockResolvedValueOnce({
        tenantId: 'tenant-1',
        selectedId: null,
        filterIds: [],
        allowedIds: [],
      })

    const beforeRevocation = await listHandler(new Request('http://localhost/api/progress/jobs'))
    const afterRevocation = await listHandler(new Request('http://localhost/api/progress/jobs'))

    expect(beforeRevocation.status).toBe(200)
    expect(afterRevocation.status).toBe(200)
    expect(mockResolveForRequest).toHaveBeenCalledTimes(2)
    expect(mockResolveForRequest.mock.calls[0][0].request).not.toBe(mockResolveForRequest.mock.calls[1][0].request)
    expect(mockFindAndCount).toHaveBeenCalledTimes(1)
  })

  it('preserves canonical superadmin tenant-wide list access', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'superadmin-1',
      tenantId: 'tenant-1',
      orgId: null,
      isSuperAdmin: true,
    })
    mockResolveForRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: null,
      filterIds: null,
      allowedIds: null,
    })

    await listHandler(new Request('http://localhost/api/progress/jobs'))

    const filter = mockFindAndCount.mock.calls[0][1]
    expect(filter).toMatchObject({ tenantId: 'tenant-1' })
    expect(filter).not.toHaveProperty('organizationId')
  })

  it('returns same-organization detail and passes the finite scope to the service', async () => {
    mockGetJob.mockResolvedValue({
      id: 'job-1',
      jobType: 'export',
      name: 'Export',
      status: 'running',
      progressPercent: 10,
      processedCount: 1,
      totalCount: 10,
      cancellable: true,
      createdAt: new Date('2026-10-04T00:00:00.000Z'),
      updatedAt: new Date('2026-10-04T00:00:00.000Z'),
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    const response = await detailGetHandler(
      new Request('http://localhost/api/progress/jobs/job-1'),
      { params: { id: 'job-1' } },
    )

    expect(response.status).toBe(200)
    expect(mockGetJob).toHaveBeenCalledWith('job-1', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      organizationIds: ['org-1'],
      userId: 'user-1',
    })
  })

  it('returns a non-disclosing 404 for a job outside the resolved organization scope', async () => {
    mockResolveForRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: 'org-2',
      filterIds: ['org-2'],
      allowedIds: ['org-2'],
    })

    const response = await detailGetHandler(
      new Request('http://localhost/api/progress/jobs/job-1'),
      { params: { id: 'job-1' } },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    expect(mockGetJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ organizationIds: ['org-2'] }),
    )
  })

  it('denies detail mutations when an explicit organization selection was rejected', async () => {
    mockResolveForRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: ['org-1'],
      selectionRejected: true,
    })

    const response = await detailPutHandler(
      new Request('http://localhost/api/progress/jobs/job-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ processedCount: 2 }),
      }),
      { params: { id: 'job-1' } },
    )

    expect(response.status).toBe(404)
    expect(mockGetJob).not.toHaveBeenCalled()
    expect(mockUpdateProgress).not.toHaveBeenCalled()
  })

  it('cancels an allowed selected-organization job with the resolved scope', async () => {
    mockGetJob.mockResolvedValue({ id: 'job-1' })

    const response = await detailDeleteHandler(
      new Request('http://localhost/api/progress/jobs/job-1', { method: 'DELETE' }),
      { params: { id: 'job-1' } },
    )

    expect(response.status).toBe(200)
    expect(mockCancelJob).toHaveBeenCalledWith('job-1', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      organizationIds: ['org-1'],
      userId: 'user-1',
    })
  })

  it('returns an empty active payload without sweeping for explicit empty scope', async () => {
    mockResolveForRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: null,
      filterIds: [],
      allowedIds: [],
    })

    const response = await activeHandler(new Request('http://localhost/api/progress/active'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ active: [], recentlyCompleted: [] })
    expect(mockMarkStaleJobsFailed).not.toHaveBeenCalled()
    expect(mockGetActiveJobs).not.toHaveBeenCalled()
  })

  it('fails closed without data calls when initial request scope resolves to another tenant', async () => {
    mockResolveForRequest.mockResolvedValue({
      tenantId: 'tenant-2',
      selectedId: 'org-2',
      filterIds: ['org-2'],
      allowedIds: ['org-2'],
    })

    const listResponse = await listHandler(new Request('http://localhost/api/progress/jobs'))
    const activeResponse = await activeHandler(new Request('http://localhost/api/progress/active'))
    const detailResponse = await detailGetHandler(
      new Request('http://localhost/api/progress/jobs/job-1'),
      { params: { id: 'job-1' } },
    )
    const updateResponse = await detailPutHandler(
      new Request('http://localhost/api/progress/jobs/job-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ processedCount: 2 }),
      }),
      { params: { id: 'job-1' } },
    )
    const deleteResponse = await detailDeleteHandler(
      new Request('http://localhost/api/progress/jobs/job-1', { method: 'DELETE' }),
      { params: { id: 'job-1' } },
    )
    const createResponse = await postHandler(new Request('http://localhost/api/progress/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobType: 'export', name: 'Export job' }),
    }))

    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    })
    expect(activeResponse.status).toBe(200)
    await expect(activeResponse.json()).resolves.toEqual({ active: [], recentlyCompleted: [] })
    for (const response of [detailResponse, updateResponse, deleteResponse]) {
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    }
    expect(createResponse.status).toBe(403)
    await expect(createResponse.json()).resolves.toEqual({ error: 'Forbidden' })

    for (const [input] of mockResolveForRequest.mock.calls) {
      expect(input).toEqual(expect.objectContaining({
        auth: expect.objectContaining({ tenantId: 'tenant-1' }),
        request: expect.any(Request),
        tenantId: 'tenant-1',
      }))
    }
    expect(mockFindAndCount).not.toHaveBeenCalled()
    expect(mockCreateJob).not.toHaveBeenCalled()
    expect(mockGetJob).not.toHaveBeenCalled()
    expect(mockUpdateProgress).not.toHaveBeenCalled()
    expect(mockCancelJob).not.toHaveBeenCalled()
    expect(mockMarkStaleJobsFailed).not.toHaveBeenCalled()
    expect(mockGetActiveJobs).not.toHaveBeenCalled()
    expect(mockGetRecentlyCompletedJobs).not.toHaveBeenCalled()
  })

  it('does not leak the error message or stack in the 500 response (CWE-209)', async () => {
    const internalDetail = '/srv/app/internal at progress_jobs_pkey; connection tenant_secret'
    mockCreateJob.mockRejectedValueOnce(new Error(internalDetail))

    const response = await postHandler(new Request('http://localhost/api/progress/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobType: 'export', name: 'Export job' }),
    }))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: 'Failed to create progress job.' })
    expect(JSON.stringify(body)).not.toContain(internalDetail)
  })
})
