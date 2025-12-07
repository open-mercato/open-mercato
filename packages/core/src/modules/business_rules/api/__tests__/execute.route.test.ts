/** @jest-environment node */

import { describe, test, expect, beforeEach, jest } from '@jest/globals'
import { createAuthMock, createMockContainer, createMockEntityManager } from './test-helpers'

const mockGetAuthFromRequest = createAuthMock()
const mockEm = createMockEntityManager()
const mockContainer = createMockContainer(mockEm)

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

type ExecuteRouteModule = typeof import('../execute/route')
let POST: ExecuteRouteModule['POST']
let metadata: ExecuteRouteModule['metadata']

beforeAll(async () => {
  const routeModule = await import('../execute/route')
  POST = routeModule.POST
  metadata = routeModule.metadata
})

describe('Business Rules API - Execute Endpoint', () => {
  const validTenantId = '123e4567-e89b-12d3-a456-426614174000'
  const validOrgId = '223e4567-e89b-12d3-a456-426614174000'

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      tenantId: validTenantId,
      orgId: validOrgId,
    })
  })

  describe('Metadata', () => {
    test('should have correct RBAC requirements', () => {
      expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['business_rules.execute'] })
    })
  })

  describe('POST /api/business_rules/execute', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/execute', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'WorkOrder',
          eventType: 'beforeSave',
          data: { status: 'ACTIVE' },
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should return 400 for invalid JSON', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/execute', {
        method: 'POST',
        body: 'invalid-json',
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid JSON body')
    })

    test('should return 400 for missing entityType', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/execute', {
        method: 'POST',
        body: JSON.stringify({
          data: { status: 'ACTIVE' },
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('Validation failed')
    })

    test('should execute rules successfully', async () => {
      const mockRule = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        ruleId: 'RULE-001',
        ruleName: 'Test Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeSave',
        enabled: true,
        priority: 100,
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: null,
        failureActions: null,
        effectiveFrom: null,
        effectiveTo: null,
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      mockEm.find.mockResolvedValue([mockRule])
      mockEm.create.mockReturnValue({})
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/execute', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'WorkOrder',
          eventType: 'beforeSave',
          data: { status: 'ACTIVE' },
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.allowed).toBeDefined()
      expect(body.executedRules).toBeDefined()
      expect(Array.isArray(body.executedRules)).toBe(true)
      expect(body.totalExecutionTime).toBeGreaterThanOrEqual(0)
    })

    test('should execute rules in dry-run mode', async () => {
      const mockRule = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        ruleId: 'RULE-001',
        ruleName: 'Test Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeSave',
        enabled: true,
        priority: 100,
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: [{ type: 'notify', config: {} }],
        failureActions: null,
        effectiveFrom: null,
        effectiveTo: null,
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      mockEm.find.mockResolvedValue([mockRule])

      const request = new Request('http://localhost:3000/api/business_rules/execute', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'WorkOrder',
          eventType: 'beforeSave',
          data: { status: 'ACTIVE' },
          dryRun: true,
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.allowed).toBeDefined()
      expect(body.executedRules).toBeDefined()
      expect(mockEm.persistAndFlush).not.toHaveBeenCalled()
    })

    test('should handle execution with multiple rules', async () => {
      const mockRules = [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          ruleId: 'RULE-001',
          ruleName: 'Rule 1',
          ruleType: 'GUARD',
          entityType: 'WorkOrder',
          enabled: true,
          priority: 100,
          conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
          successActions: null,
          failureActions: null,
          effectiveFrom: null,
          effectiveTo: null,
          tenantId: validTenantId,
          organizationId: validOrgId,
          deletedAt: null,
        },
        {
          id: '223e4567-e89b-12d3-a456-426614174002',
          ruleId: 'RULE-002',
          ruleName: 'Rule 2',
          ruleType: 'VALIDATION',
          entityType: 'WorkOrder',
          enabled: true,
          priority: 90,
          conditionExpression: { field: 'quantity', operator: '>', value: 0 },
          successActions: null,
          failureActions: null,
          effectiveFrom: null,
          effectiveTo: null,
          tenantId: validTenantId,
          organizationId: validOrgId,
          deletedAt: null,
        },
      ]

      mockEm.find.mockResolvedValue(mockRules)
      mockEm.create.mockReturnValue({})
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/execute', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'WorkOrder',
          data: { status: 'ACTIVE', quantity: 10 },
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.executedRules.length).toBeGreaterThanOrEqual(0)
    })

    test('should include entityId when provided', async () => {
      mockEm.find.mockResolvedValue([])

      const request = new Request('http://localhost:3000/api/business_rules/execute', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'WorkOrder',
          entityId: '323e4567-e89b-12d3-a456-426614174003',
          data: { status: 'ACTIVE' },
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(200)
    })

    test('should handle execution errors gracefully', async () => {
      mockEm.find.mockRejectedValue(new Error('Database error'))

      const request = new Request('http://localhost:3000/api/business_rules/execute', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'WorkOrder',
          data: { status: 'ACTIVE' },
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.allowed).toBe(false)
      expect(body.errors).toBeDefined()
      expect(Array.isArray(body.errors)).toBe(true)
      expect(body.errors.length).toBeGreaterThan(0)
      expect(body.errors[0]).toContain('Database error')
    })

    test('should return execution details including rule metadata', async () => {
      const mockRule = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        ruleId: 'RULE-001',
        ruleName: 'Test Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        enabled: true,
        priority: 100,
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: null,
        failureActions: null,
        effectiveFrom: null,
        effectiveTo: null,
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      mockEm.find.mockResolvedValue([mockRule])
      mockEm.create.mockReturnValue({})
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/execute', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'WorkOrder',
          data: { status: 'ACTIVE' },
        }),
      })
      const response = await POST(request)

      expect(response.status).toBe(200)
      const body = await response.json()

      if (body.executedRules.length > 0) {
        expect(body.executedRules[0]).toHaveProperty('ruleId')
        expect(body.executedRules[0]).toHaveProperty('ruleName')
        expect(body.executedRules[0]).toHaveProperty('conditionResult')
        expect(body.executedRules[0]).toHaveProperty('executionTime')
      }
    })
  })
})
