const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const progressJobId = '44444444-4444-4444-8444-444444444444'

const getStatusMock = jest.fn()
const createJobMock = jest.fn()
const enqueueMock = jest.fn()
const failJobMock = jest.fn()
const runGuardsMock = jest.fn()
const resolveScopeMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'catalogCategorizationService') {
      return { getStatus: (...args: unknown[]) => getStatusMock(...args) }
    }
    if (name === 'progressService') {
      return {
        createJob: (...args: unknown[]) => createJobMock(...args),
        failJob: (...args: unknown[]) => failJobMock(...args),
      }
    }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

let authValue: Record<string, unknown> | null = { tenantId, sub: userId, orgId: organizationId }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveScopeMock(...args),
}))
jest.mock('../../../../lib/bulkCreateMutationGuards', () => ({
  runBulkCreateMutationGuards: (...args: unknown[]) => runGuardsMock(...args),
}))
jest.mock('../../../../lib/catalogQueue', () => ({
  getCatalogQueue: jest.fn(() => ({ enqueue: (...args: unknown[]) => enqueueMock(...args) })),
}))

import { POST, metadata } from '../route'
import { CATALOG_PRODUCT_AI_CATEGORIZE_MAX_PRODUCTS } from '../../../../lib/aiCategorization/bulkLimits'

const uuidFor = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`

const makeRequest = (body: unknown) =>
  new Request('http://localhost/api/catalog/ai-categorization/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('catalog ai-categorization bulk route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, sub: userId, orgId: organizationId }
    resolveScopeMock.mockResolvedValue({ selectedId: organizationId, selectionRejected: false })
    getStatusMock.mockResolvedValue({ available: true, enabled: true, effective: true, settings: {} })
    runGuardsMock.mockResolvedValue({ ok: true })
    createJobMock.mockResolvedValue({ id: progressJobId })
    enqueueMock.mockResolvedValue('job')
    failJobMock.mockResolvedValue(undefined)
  })

  it('requires the ai_categorization.use feature', () => {
    expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['catalog.ai_categorization.use'] })
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await POST(makeRequest({ productIds: [uuidFor(1)] }))
    expect(response.status).toBe(401)
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it('rejects an empty id list and non-uuid ids with a 400', async () => {
    const empty = await POST(makeRequest({ productIds: [] }))
    expect(empty.status).toBe(400)
    const invalid = await POST(makeRequest({ productIds: ['not-a-uuid'] }))
    expect(invalid.status).toBe(400)
    const body = await invalid.json()
    expect(body.errors[0].path).toBe('productIds.0')
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it('rejects more than the maximum number of products', async () => {
    const tooMany = Array.from({ length: CATALOG_PRODUCT_AI_CATEGORIZE_MAX_PRODUCTS + 1 }, (_, index) => uuidFor(index))
    const response = await POST(makeRequest({ productIds: tooMany }))
    expect(response.status).toBe(400)
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it('accepts exactly the maximum number of products', async () => {
    const atCap = Array.from({ length: CATALOG_PRODUCT_AI_CATEGORIZE_MAX_PRODUCTS }, (_, index) => uuidFor(index))
    const response = await POST(makeRequest({ productIds: atCap }))
    expect(response.status).toBe(202)
  })

  it('returns 409 and creates no job when the feature is not effective', async () => {
    getStatusMock.mockResolvedValue({ available: false, reason: 'not_configured', enabled: true, effective: false, settings: {} })
    const response = await POST(makeRequest({ productIds: [uuidFor(1)] }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ code: 'ai_categorization_unavailable', reason: 'not_configured' })
    expect(createJobMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('returns the guard decision without creating a job when a mutation guard blocks', async () => {
    runGuardsMock.mockResolvedValue({ ok: false, status: 423, body: { error: 'locked' } })
    const response = await POST(makeRequest({ productIds: [uuidFor(1)] }))
    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual({ error: 'locked' })
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it('requires an organization context', async () => {
    resolveScopeMock.mockResolvedValue({ selectedId: null, selectionRejected: false })
    const response = await POST(makeRequest({ productIds: [uuidFor(1)] }))
    expect(response.status).toBe(400)
  })

  it('creates a cancellable progress job, dedupes ids and enqueues the worker payload', async () => {
    const response = await POST(makeRequest({ productIds: [uuidFor(1), uuidFor(1), uuidFor(2)], scope: 'filtered' }))
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ ok: true, progressJobId })

    expect(runGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({ itemCount: 2, organizationId, tenantId }),
    )
    expect(createJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'catalog.products.ai_categorize',
        totalCount: 2,
        cancellable: true,
      }),
      { tenantId, organizationId, userId },
    )
    expect(enqueueMock).toHaveBeenCalledWith({
      progressJobId,
      ids: [uuidFor(1), uuidFor(2)],
      scope: { organizationId, tenantId, userId },
    })
  })

  it('fails the progress job it created when enqueueing throws, so no phantom job is left pending', async () => {
    enqueueMock.mockRejectedValue(new Error('redis down'))
    const response = await POST(makeRequest({ productIds: [uuidFor(1)] }))
    expect(response.status).toBe(500)
    expect(failJobMock).toHaveBeenCalledWith(
      progressJobId,
      { errorMessage: 'Bulk AI categorization could not be queued' },
      { tenantId, organizationId, userId },
    )
  })
})
