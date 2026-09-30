/**
 * Workflow Functions API Tests
 *
 * Step 4.5: GET /api/workflows/functions returns the registered workflow
 * function descriptors for the EXECUTE_FUNCTION function picker, gated on
 * workflows.definitions.edit.
 */

import { NextRequest } from 'next/server'
import { GET as listFunctions } from '../functions/route'
import {
  clearWorkflowFunctionsForTests,
  registerWorkflowFunctions,
} from '../../lib/workflow-function-registry'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

describe('Workflow Functions API', () => {
  let mockContainer: { resolve: jest.Mock }
  let mockRbacService: { userHasAllFeatures: jest.Mock }

  const testTenantId = 'test-tenant-id'
  const testOrgId = 'test-org-id'
  const testUserId = 'test-user-id'

  const makeRequest = () => new NextRequest('http://localhost/api/workflows/functions')

  beforeEach(() => {
    clearWorkflowFunctionsForTests()

    mockRbacService = {
      userHasAllFeatures: jest.fn().mockResolvedValue(true),
    }

    mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'rbacService') return mockRbacService
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

  afterEach(() => {
    clearWorkflowFunctionsForTests()
    jest.clearAllMocks()
  })

  it('returns registered function descriptors in registration order', async () => {
    registerWorkflowFunctions([
      { name: 'inventory.recalculateStock', labelKey: 'inventory.workflowFunctions.recalculateStock' },
      { name: 'sales.computeDiscount', description: 'Computes the applicable discount' },
    ])

    const response = await listFunctions(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      items: [
        { name: 'inventory.recalculateStock', labelKey: 'inventory.workflowFunctions.recalculateStock' },
        { name: 'sales.computeDiscount', description: 'Computes the applicable discount' },
      ],
    })
  })

  it('returns an empty list when nothing is registered', async () => {
    const response = await listFunctions(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ items: [] })
  })

  it('gates on workflows.definitions.edit with tenant scope', async () => {
    await listFunctions(makeRequest())

    expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
      testUserId,
      ['workflows.definitions.edit'],
      { tenantId: testTenantId, organizationId: testOrgId }
    )
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue(null)

    const response = await listFunctions(makeRequest())

    expect(response.status).toBe(401)
  })

  it('returns 400 when tenant context is missing', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: testUserId, tenantId: null, orgId: testOrgId })

    const response = await listFunctions(makeRequest())

    expect(response.status).toBe(400)
  })

  it('returns 403 when the feature check fails', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)

    const response = await listFunctions(makeRequest())

    expect(response.status).toBe(403)
  })
})
