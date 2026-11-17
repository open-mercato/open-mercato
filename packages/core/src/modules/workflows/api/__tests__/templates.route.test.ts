/**
 * Workflow Templates API Tests
 *
 * Step 7.1: GET /api/workflows/templates returns the shipped template
 * gallery (metadata + full definitions), gated on workflows.definitions.view.
 */

import { NextRequest } from 'next/server'
import { GET as listTemplates } from '../templates/route'
import { WORKFLOW_TEMPLATE_FILES } from '../../lib/workflow-templates'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

describe('Workflow Templates API', () => {
  let mockContainer: { resolve: jest.Mock }
  let mockRbacService: { userHasAllFeatures: jest.Mock }

  const testTenantId = 'test-tenant-id'
  const testOrgId = 'test-org-id'
  const testUserId = 'test-user-id'

  const makeRequest = () => new NextRequest('http://localhost/api/workflows/templates')

  beforeEach(() => {
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
    jest.clearAllMocks()
  })

  it('returns all shipped templates with metadata and definitions', async () => {
    const response = await listTemplates(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(WORKFLOW_TEMPLATE_FILES.length)
    for (const item of body.items) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/)
      expect(item.nameKey).toBe(`workflows.templates.${item.id}.name`)
      expect(item.descriptionKey).toBe(`workflows.templates.${item.id}.description`)
      expect(typeof item.category).toBe('string')
      expect(typeof item.icon).toBe('string')
      expect(Array.isArray(item.definition.steps)).toBe(true)
      expect(Array.isArray(item.definition.transitions)).toBe(true)
      expect(item.definition.steps.length).toBeGreaterThanOrEqual(2)
      expect(item.definition.transitions.length).toBeGreaterThanOrEqual(1)
    }
    const ids = body.items.map((item: { id: string }) => item.id)
    expect(ids).toEqual(['order-approval', 'lead-to-install', 'task-escalation', 'webhook-integration'])
  })

  it('gates on workflows.definitions.view with tenant scope', async () => {
    await listTemplates(makeRequest())

    expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
      testUserId,
      ['workflows.definitions.view'],
      { tenantId: testTenantId, organizationId: testOrgId }
    )
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue(null)

    const response = await listTemplates(makeRequest())

    expect(response.status).toBe(401)
  })

  it('returns 400 when tenant context is missing', async () => {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: testUserId, tenantId: null, orgId: testOrgId })

    const response = await listTemplates(makeRequest())

    expect(response.status).toBe(400)
  })

  it('returns 403 when the feature check fails', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)

    const response = await listTemplates(makeRequest())

    expect(response.status).toBe(403)
  })
})
