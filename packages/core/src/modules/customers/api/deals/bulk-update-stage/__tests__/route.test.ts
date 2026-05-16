/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const dealId = '44444444-4444-4444-8444-444444444444'
const stageId = '55555555-5555-4555-8555-555555555555'
const progressJobId = '66666666-6666-4666-8666-666666666666'

const createJobMock = jest.fn()
const enqueueMock = jest.fn()
const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'progressService') {
      return { createJob: createJobMock }
    }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: userId,
    tenantId,
    orgId: organizationId,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) =>
    runCrudMutationGuardAfterSuccessMock(...args),
}))

jest.mock('../../../../lib/bulkDeals', () => ({
  CUSTOMERS_DEALS_BULK_UPDATE_STAGE_QUEUE: 'customers-deals-bulk-update-stage',
  getCustomersQueue: jest.fn(() => ({ enqueue: enqueueMock })),
}))

import { POST } from '../route'

describe('customers deals bulk-update-stage route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createJobMock.mockResolvedValue({ id: progressJobId })
    enqueueMock.mockResolvedValue(undefined)
    validateCrudMutationGuardMock.mockResolvedValue({
      ok: true,
      shouldRunAfterSuccess: true,
      metadata: { token: 'guard' },
    })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('creates a progress job and enqueues the scoped stage update payload', async () => {
    const response = await POST(
      new Request('http://localhost/api/customers/deals/bulk-update-stage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [dealId], pipelineStageId: stageId }),
      }),
    )

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      progressJobId,
    })
    expect(createJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'customers.deals.bulk_update_stage',
        totalCount: 1,
        meta: expect.objectContaining({ pipelineStageId: stageId }),
      }),
      { tenantId, organizationId, userId },
    )
    expect(enqueueMock).toHaveBeenCalledWith({
      progressJobId,
      ids: [dealId],
      pipelineStageId: stageId,
      scope: { organizationId, tenantId, userId },
    })
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
  })

  it('returns 400 when the request body fails zod validation', async () => {
    const response = await POST(
      new Request('http://localhost/api/customers/deals/bulk-update-stage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [], pipelineStageId: stageId }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
    expect(createJobMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('returns 400 when ids contains a non-UUID', async () => {
    const response = await POST(
      new Request('http://localhost/api/customers/deals/bulk-update-stage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ['not-a-uuid'], pipelineStageId: stageId }),
      }),
    )

    expect(response.status).toBe(400)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('returns mutation-guard status when the guard rejects', async () => {
    validateCrudMutationGuardMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: { error: { code: 'RECORD_LOCKED' } },
    })

    const response = await POST(
      new Request('http://localhost/api/customers/deals/bulk-update-stage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [dealId], pipelineStageId: stageId }),
      }),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'RECORD_LOCKED' } })
    expect(createJobMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })
})
