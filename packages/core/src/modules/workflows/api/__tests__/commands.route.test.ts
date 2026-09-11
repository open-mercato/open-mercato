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
  let storedEnabledCommandIds: Record<string, unknown>

  const testTenantId = 'test-tenant-id'
  const testOrgId = 'test-org-id'
  const testUserId = 'test-user-id'

  const makeRequest = () => new NextRequest('http://localhost/api/workflows/commands')

  beforeEach(() => {
    clearWorkflowSafeCommandsForTests()
    storedEnabledCommandIds = {}

    mockRbacService = {
      userHasAllFeatures: jest.fn().mockResolvedValue(true),
    }

    mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'rbacService') return mockRbacService
        if (name === 'moduleConfigService') {
          return {
            getValue: async (_moduleId: string, _key: string, options?: any) =>
              storedEnabledCommandIds[String(options?.scope?.tenantId ?? null)],
            setValue: async () => null,
          }
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

  afterEach(() => {
    clearWorkflowSafeCommandsForTests()
    jest.clearAllMocks()
  })

  it('returns registered commands in registration order', async () => {
    registerWorkflowSafeCommands([
      { commandId: 'sales.orders.update', requiredFeatures: ['sales.orders.manage'], defaultEnabled: true },
      { commandId: 'customers.people.update', requiredFeatures: ['customers.people.manage', 'customers.view'] },
    ])

    const response = await listCommands(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      items: [
        {
          commandId: 'sales.orders.update',
          requiredFeatures: ['sales.orders.manage'],
          labelKey: null,
          enabled: true,
          defaultEnabled: true,
        },
        {
          commandId: 'customers.people.update',
          requiredFeatures: ['customers.people.manage', 'customers.view'],
          labelKey: null,
          enabled: false,
          defaultEnabled: false,
        },
      ],
    })
  })

  it('reports a candidate the tenant has NOT enabled rather than hiding it', async () => {
    registerWorkflowSafeCommands([
      { commandId: 'catalog.products.update', requiredFeatures: ['catalog.products.manage'] },
    ])

    const body = await (await listCommands(makeRequest())).json()

    // Present — the field accepts free text, so hiding it would replace a
    // runtime failure with an unexplained absence — but explicitly disabled.
    expect(body.items).toEqual([
      expect.objectContaining({ commandId: 'catalog.products.update', enabled: false }),
    ])
  })

  it('reports a candidate this tenant HAS enabled as available', async () => {
    registerWorkflowSafeCommands([
      { commandId: 'catalog.products.update', requiredFeatures: ['catalog.products.manage'] },
    ])
    storedEnabledCommandIds[testTenantId] = ['catalog.products.update']

    const body = await (await listCommands(makeRequest())).json()

    expect(body.items).toEqual([
      expect.objectContaining({ commandId: 'catalog.products.update', enabled: true }),
    ])
  })

  it('does not leak another tenant enablement', async () => {
    registerWorkflowSafeCommands([
      { commandId: 'catalog.products.update', requiredFeatures: ['catalog.products.manage'] },
    ])
    storedEnabledCommandIds['other-tenant-id'] = ['catalog.products.update']

    const body = await (await listCommands(makeRequest())).json()

    expect(body.items).toEqual([
      expect.objectContaining({ commandId: 'catalog.products.update', enabled: false }),
    ])
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
