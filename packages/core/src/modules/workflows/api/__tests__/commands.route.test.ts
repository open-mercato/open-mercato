/**
 * Workflow-Safe Commands API Tests
 *
 * Step 4.4: GET /api/workflows/commands returns the registered
 * workflow-safe command allowlist for the UPDATE_ENTITY command picker,
 * gated on workflows.definitions.edit.
 */

import { NextRequest } from 'next/server'
import { GET as listCommands } from '../commands/route'
import {
  clearWorkflowSafeCommandsForTests,
  registerWorkflowSafeCommands,
} from '../../lib/workflow-safe-commands'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

describe('Workflow-Safe Commands API', () => {
  let mockContainer: { resolve: jest.Mock }
  let mockRbacService: { userHasAllFeatures: jest.Mock }

  const testTenantId = 'test-tenant-id'
  const testOrgId = 'test-org-id'
  const testUserId = 'test-user-id'

  const makeRequest = () => new NextRequest('http://localhost/api/workflows/commands')

  beforeEach(() => {
    clearWorkflowSafeCommandsForTests()

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
    clearWorkflowSafeCommandsForTests()
    jest.clearAllMocks()
  })

  it('returns registered commands in registration order', async () => {
    registerWorkflowSafeCommands([
      { commandId: 'sales.orders.update', requiredFeatures: ['sales.orders.manage'] },
      { commandId: 'customers.people.update', requiredFeatures: ['customers.people.manage', 'customers.view'] },
    ])

    const response = await listCommands(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      items: [
        { commandId: 'sales.orders.update', requiredFeatures: ['sales.orders.manage'] },
        { commandId: 'customers.people.update', requiredFeatures: ['customers.people.manage', 'customers.view'] },
      ],
    })
  })

  it('returns an empty list when nothing is registered', async () => {
    const response = await listCommands(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ items: [] })
  })

  it('gates on workflows.definitions.edit with tenant scope', async () => {
    await listCommands(makeRequest())

    expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
      testUserId,
      ['workflows.definitions.edit'],
      { tenantId: testTenantId, organizationId: testOrgId }
    )
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue(null)

    const response = await listCommands(makeRequest())

    expect(response.status).toBe(401)
  })

  it('returns 400 when tenant context is missing', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: testUserId, tenantId: null, orgId: testOrgId })

    const response = await listCommands(makeRequest())

    expect(response.status).toBe(400)
  })

  it('returns 403 when the feature check fails', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)

    const response = await listCommands(makeRequest())

    expect(response.status).toBe(403)
  })
})
