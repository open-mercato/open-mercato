/**
 * Step-through control route (spec section 8.2).
 *
 * The two things a reviewer cannot verify by eye: the release token is minted
 * from the instance's own cursor (never from the request), and the route is
 * gated on the test-run feature and tenant scope.
 */

import { NextRequest } from 'next/server'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('../../lib/workflow-executor', () => ({
  executeWorkflow: jest.fn(),
}))

jest.mock('../../lib/event-logger', () => ({
  logWorkflowEvent: jest.fn(),
}))

import { POST as stepThrough } from '../instances/[id]/step-through/route'
import * as workflowExecutor from '../../lib/workflow-executor'

const testTenantId = 'tenant-1'
const testOrgId = 'org-1'
const testInstanceId = '11111111-1111-4111-8111-111111111111'

function makeContext() {
  return { params: Promise.resolve({ id: testInstanceId }) }
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/step-through`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/workflows/instances/[id]/step-through', () => {
  let instance: Record<string, unknown>
  let mockEm: { findOne: jest.Mock; flush: jest.Mock }
  let mockRbac: { userHasAllFeatures: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    instance = {
      id: testInstanceId,
      tenantId: testTenantId,
      organizationId: testOrgId,
      status: 'PAUSED',
      currentStepId: 'charge',
      metadata: { stepThrough: { enabled: true, releaseStepId: null } },
    }

    mockEm = {
      findOne: jest.fn().mockResolvedValue(instance),
      flush: jest.fn(),
    }
    mockRbac = { userHasAllFeatures: jest.fn().mockResolvedValue(true) }

    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? mockEm : name === 'rbacService' ? mockRbac : null),
    })

    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: testTenantId, orgId: testOrgId })

    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: testOrgId })
    ;(workflowExecutor.executeWorkflow as jest.Mock).mockResolvedValue({
      status: 'RUNNING',
      currentStep: 'notify',
      context: {},
      events: [],
      executionTime: 1,
    })
  })

  test('is gated on the test-run feature', () => {
    const { metadata } = require('../instances/[id]/step-through/route')
    expect(metadata.requireFeatures).toEqual(['workflows.definitions.test_run'])
  })

  test('mints the release token from the instance cursor, never from the request body', async () => {
    const response = await stepThrough(
      makeRequest({ action: 'continue', releaseStepId: 'some-other-step' }),
      makeContext(),
    )

    expect(response.status).toBe(200)
    expect(instance.metadata).toMatchObject({
      stepThrough: { enabled: true, releaseStepId: 'charge' },
    })
  })

  test('flips PAUSED back to RUNNING before re-entering the executor', async () => {
    await stepThrough(makeRequest({ action: 'continue' }), makeContext())

    expect(instance.status).toBe('RUNNING')
    expect(instance.pausedAt).toBeNull()
    expect(workflowExecutor.executeWorkflow).toHaveBeenCalledWith(
      mockEm,
      expect.anything(),
      testInstanceId,
      expect.objectContaining({ userId: 'user-1' }),
    )
  })

  test('"stop" clears the marker so the run finishes on its own', async () => {
    await stepThrough(makeRequest({ action: 'stop' }), makeContext())

    expect((instance.metadata as Record<string, unknown>).stepThrough).toBeNull()
    expect(workflowExecutor.executeWorkflow).toHaveBeenCalled()
  })

  test('refuses a run that is not stepping, and executes nothing', async () => {
    instance.metadata = {}

    const response = await stepThrough(makeRequest({ action: 'continue' }), makeContext())

    expect(response.status).toBe(400)
    expect(workflowExecutor.executeWorkflow).not.toHaveBeenCalled()
  })

  test('scopes the instance lookup to the caller tenant', async () => {
    await stepThrough(makeRequest({ action: 'continue' }), makeContext())

    expect(mockEm.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: testInstanceId, tenantId: testTenantId }),
    )
  })

  test('404s an instance outside the caller scope', async () => {
    mockEm.findOne.mockResolvedValue(null)

    const response = await stepThrough(makeRequest({ action: 'continue' }), makeContext())
    expect(response.status).toBe(404)
  })

  test('403s without the test-run feature', async () => {
    mockRbac.userHasAllFeatures.mockResolvedValue(false)

    const response = await stepThrough(makeRequest({ action: 'continue' }), makeContext())
    expect(response.status).toBe(403)
    expect(workflowExecutor.executeWorkflow).not.toHaveBeenCalled()
  })

  test('rejects an unknown action', async () => {
    const response = await stepThrough(makeRequest({ action: 'obliterate' }), makeContext())
    expect(response.status).toBe(400)
  })
})
