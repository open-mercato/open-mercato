/**
 * Workflow Definition Test-Step API Tests — strict interpolation mirroring
 *
 * The mock-first dry run honors the definition's `interpolation` mode: under
 * strict mode an unresolvable token responds 200 with a structured
 * `{ interpolationFailed: true, token, message }` body; lenient (or absent)
 * definitions keep the legacy pass-through behavior.
 */

import { NextRequest } from 'next/server'
import { POST as testStep } from '../definitions/[id]/test-step/route'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

describe('POST /api/workflows/definitions/[id]/test-step', () => {
  const testTenantId = 'test-tenant-id'
  const testOrgId = 'test-org-id'
  const testUserId = 'test-user-id'
  const definitionId = '11111111-2222-4333-8444-555555555555'

  let mockEm: { findOne: jest.Mock }

  const makeDefinition = (interpolation?: 'strict' | 'lenient') => ({
    id: definitionId,
    workflowId: 'test-workflow',
    version: 1,
    definition: {
      steps: [],
      transitions: [],
      ...(interpolation ? { interpolation } : {}),
    },
  })

  beforeEach(() => {
    mockEm = { findOne: jest.fn() }

    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'rbacService') {
          return { userHasAllFeatures: jest.fn().mockResolvedValue(true) }
        }
        return null
      }),
    }

    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue(mockContainer)

    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({
      sub: testUserId,
      tenantId: testTenantId,
      orgId: testOrgId,
    })

    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: testOrgId })
  })

  const runTestStep = async (body: Record<string, unknown>) => {
    const request = new NextRequest(`http://localhost/api/workflows/definitions/${definitionId}/test-step`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const response = await testStep(request, { params: Promise.resolve({ id: definitionId }) })
    return { response, data: await response.json() }
  }

  test('strict definition mirrors an unresolvable token as a structured 200 failure', async () => {
    mockEm.findOne.mockResolvedValue(makeDefinition('strict'))

    const { response, data } = await runTestStep({
      activityType: 'SEND_EMAIL',
      config: { to: '{{missing.path}}', subject: 'Hi' },
      context: {},
    })

    expect(response.status).toBe(200)
    expect(data.interpolationFailed).toBe(true)
    expect(data.token).toBe('missing.path')
    expect(data.message).toContain('Cannot interpolate {{missing.path}}')
    expect(data.activityType).toBe('SEND_EMAIL')
  })

  test('lenient definition keeps the legacy pass-through behavior', async () => {
    mockEm.findOne.mockResolvedValue(makeDefinition('lenient'))

    const { response, data } = await runTestStep({
      activityType: 'SEND_EMAIL',
      config: { to: '{{missing.path}}', subject: 'Hi' },
      context: {},
    })

    expect(response.status).toBe(200)
    expect(data.simulated).toBe(true)
    expect(data.interpolatedConfig.to).toBe('{{missing.path}}')
  })

  test('definition without an interpolation mode stays lenient', async () => {
    mockEm.findOne.mockResolvedValue(makeDefinition())

    const { response, data } = await runTestStep({
      activityType: 'SEND_EMAIL',
      config: { to: '{{missing.path}}' },
      context: {},
    })

    expect(response.status).toBe(200)
    expect(data.simulated).toBe(true)
    expect(data.interpolatedConfig.to).toBe('{{missing.path}}')
  })

  test('strict definition resolves valid tokens and simulates normally', async () => {
    mockEm.findOne.mockResolvedValue(makeDefinition('strict'))

    const { response, data } = await runTestStep({
      activityType: 'SEND_EMAIL',
      config: { to: '{{customerEmail}}', subject: 'Order {{orderId | upper}}' },
      context: { customerEmail: 'jane@example.com', orderId: 'ord-42' },
    })

    expect(response.status).toBe(200)
    expect(data.simulated).toBe(true)
    expect(data.interpolatedConfig).toEqual({ to: 'jane@example.com', subject: 'Order ORD-42' })
  })
})
