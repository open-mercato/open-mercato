/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockCreateJob = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(() => mockCreateRequestContainer()),
}))

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']
let metadata: RouteModule['metadata']
let activeMetadata: typeof import('../../active/route')['metadata']
let detailMetadata: typeof import('../[id]/route')['metadata']

beforeAll(async () => {
  const routeModule = await import('../route')
  const activeRouteModule = await import('../../active/route')
  const detailRouteModule = await import('../[id]/route')
  postHandler = routeModule.POST
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
        if (token === 'progressService') return { createJob: mockCreateJob }
        throw new Error(`Unexpected token: ${token}`)
      },
    })
    mockCreateJob.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
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
