/**
 * Step-instance read surface (spec §8.3).
 *
 * `StepInstance` rows carry the per-step input/output/duration/attempts the run
 * views need; before this route nothing read them. The tenant scoping and the
 * page cap are the two things a reviewer cannot verify by eye.
 */

import { NextRequest } from 'next/server'
import { GET as listSteps, STEP_INSTANCE_PAGE_SIZE_MAX } from '../instances/[id]/steps/route'
import { WorkflowInstance, StepInstance } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

const testTenantId = 'tenant-1'
const testOrgId = 'org-1'
const testInstanceId = '11111111-1111-4111-8111-111111111111'

function makeContext() {
  return { params: Promise.resolve({ id: testInstanceId }) }
}

describe('GET /api/workflows/instances/[id]/steps', () => {
  let mockEm: {
    findOne: jest.Mock
    findAndCount: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockEm = {
      findOne: jest.fn().mockResolvedValue({ id: testInstanceId, tenantId: testTenantId }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    }

    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? mockEm : null),
    })

    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: testTenantId, orgId: testOrgId })

    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: testOrgId })
  })

  test('is gated on the instance-view feature', () => {
    const { metadata } = require('../instances/[id]/steps/route')
    expect(metadata.requireFeatures).toEqual(['workflows.instances.view'])
  })

  test('returns the step executions in entry order', async () => {
    const steps = [
      {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'validate',
        stepName: 'Validate',
        stepType: 'AUTOMATED',
        status: 'COMPLETED',
        inputData: { orderId: 'o-1' },
        outputData: { ok: true },
        executionTimeMs: 42,
        retryCount: 0,
      },
    ]
    mockEm.findAndCount.mockResolvedValue([steps, 1])

    const response = await listSteps(
      new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/steps`),
      makeContext()
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual(steps)
    expect(body.pagination).toEqual({
      total: 1,
      limit: STEP_INSTANCE_PAGE_SIZE_MAX,
      offset: 0,
      hasMore: false,
    })
    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      StepInstance,
      expect.objectContaining({
        workflowInstanceId: testInstanceId,
        tenantId: testTenantId,
      }),
      expect.objectContaining({
        orderBy: [{ enteredAt: 'ASC' }, { createdAt: 'ASC' }],
      })
    )
  })

  test('scopes the instance lookup to the caller tenant and organization', async () => {
    await listSteps(
      new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/steps`),
      makeContext()
    )

    expect(mockEm.findOne).toHaveBeenCalledWith(
      WorkflowInstance,
      expect.objectContaining({
        id: testInstanceId,
        tenantId: testTenantId,
        organizationId: { $in: [testOrgId] },
      })
    )
  })

  test('scopes the step query to the caller organization', async () => {
    await listSteps(
      new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/steps`),
      makeContext()
    )

    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      StepInstance,
      expect.objectContaining({ organizationId: { $in: [testOrgId] } }),
      expect.any(Object)
    )
  })

  test('404s an instance belonging to another tenant instead of leaking its steps', async () => {
    mockEm.findOne.mockResolvedValue(null)

    const response = await listSteps(
      new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/steps`),
      makeContext()
    )

    expect(response.status).toBe(404)
    expect(mockEm.findAndCount).not.toHaveBeenCalled()
  })

  test('caps the page size at the platform maximum', async () => {
    await listSteps(
      new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/steps?limit=5000`),
      makeContext()
    )

    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      StepInstance,
      expect.any(Object),
      expect.objectContaining({ limit: STEP_INSTANCE_PAGE_SIZE_MAX })
    )
  })

  test('ignores a non-numeric or negative offset rather than passing it through', async () => {
    await listSteps(
      new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/steps?offset=-10&limit=abc`),
      makeContext()
    )

    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      StepInstance,
      expect.any(Object),
      expect.objectContaining({ offset: 0, limit: STEP_INSTANCE_PAGE_SIZE_MAX })
    )
  })

  test('reports hasMore when the run has more steps than one page', async () => {
    mockEm.findAndCount.mockResolvedValue([[], 250])

    const response = await listSteps(
      new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/steps`),
      makeContext()
    )
    const body = await response.json()

    expect(body.pagination.hasMore).toBe(true)
    expect(body.pagination.total).toBe(250)
  })
})
