/** @jest-environment node */

import { describe, test, expect, beforeEach, jest } from '@jest/globals'
import { createAuthMock, createMockContainer, createMockEntityManager } from './test-helpers'

const mockGetAuthFromRequest = createAuthMock()
const mockEm = createMockEntityManager()
const mockContainer = createMockContainer(mockEm)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

const enStrings: Record<string, string> = require('../../i18n/en.json')
const mockTranslator = (key: string, fallbackOrParams?: string | Record<string, any>, params?: Record<string, any>) => {
  const resolvedParams = typeof fallbackOrParams === 'object' ? fallbackOrParams : params
  let text = enStrings[key] || (typeof fallbackOrParams === 'string' ? fallbackOrParams : key)
  if (resolvedParams) {
    for (const [k, v] of Object.entries(resolvedParams)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    }
  }
  return text
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    dict: enStrings,
    t: mockTranslator,
    translate: mockTranslator,
  })),
}))

type RouteModule = typeof import('../rules/route')
let GET: RouteModule['GET']
let POST: RouteModule['POST']
let PUT: RouteModule['PUT']
let DELETE: RouteModule['DELETE']
let metadata: RouteModule['metadata']

beforeAll(async () => {
  const routeModule = await import('../rules/route')
  GET = routeModule.GET
  POST = routeModule.POST
  PUT = routeModule.PUT
  DELETE = routeModule.DELETE
  metadata = routeModule.metadata
})

describe('Business Rules API - /api/business_rules/rules', () => {
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
      expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['business_rules.view'] })
      expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['business_rules.manage'] })
      expect(metadata.PUT).toEqual({ requireAuth: true, requireFeatures: ['business_rules.manage'] })
      expect(metadata.DELETE).toEqual({ requireAuth: true, requireFeatures: ['business_rules.manage'] })
    })
  })

  describe('GET - List rules', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/rules')
      const response = await GET(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should return paginated list of rules', async () => {
      const mockRules = [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          ruleId: 'RULE-001',
          ruleName: 'Test Rule 1',
          description: 'Description 1',
          ruleType: 'GUARD',
          ruleCategory: 'validation',
          entityType: 'WorkOrder',
          eventType: 'beforeSave',
          enabled: true,
          priority: 100,
          version: 1,
          effectiveFrom: new Date('2024-01-01'),
          effectiveTo: null,
          tenantId: 'tenant-123',
          organizationId: 'org-456',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ]

      mockEm.findAndCount.mockResolvedValue([mockRules, 1])

      const request = new Request('http://localhost:3000/api/business_rules/rules?page=1&pageSize=50')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items).toHaveLength(1)
      expect(body.total).toBe(1)
      expect(body.totalPages).toBe(1)
      expect(body.items[0].ruleId).toBe('RULE-001')
    })

    test('should filter by enabled status', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/rules?enabled=true')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: true }),
        expect.anything()
      )
    })

    test('should filter by entityType', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/rules?entityType=WorkOrder')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ entityType: 'WorkOrder' }),
        expect.anything()
      )
    })

    test('should search by rule name', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/rules?search=validation')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ruleName: { $ilike: '%validation%' } }),
        expect.anything()
      )
    })
  })

  describe('POST - Create rule', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify({ ruleId: 'TEST-001', ruleName: 'Test' }),
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should create a new rule', async () => {
      const newRule = {
        ruleId: 'RULE-NEW',
        ruleName: 'New Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
      }

      mockEm.create.mockReturnValue({ id: '223e4567-e89b-12d3-a456-426614174002', ...newRule })
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(newRule),
      })
      const response = await POST(request)

      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.id).toBe('223e4567-e89b-12d3-a456-426614174002')
      expect(mockEm.create).toHaveBeenCalled()
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
    })

    test('should return 400 for invalid rule data', async () => {
      const invalidRule = {
        ruleId: '',
        ruleName: 'Test',
      }

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(invalidRule),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('Validation failed')
    })

    test('should inject tenantId and organizationId from auth', async () => {
      const newRule = {
        ruleId: 'RULE-NEW',
        ruleName: 'New Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
      }

      mockEm.create.mockReturnValue({ id: '223e4567-e89b-12d3-a456-426614174002', ...newRule })
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(newRule),
      })
      await POST(request)

      expect(mockEm.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: validTenantId,
          organizationId: validOrgId,
          createdBy: 'user-1',
        })
      )
    })
  })

  describe('PUT - Update rule', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'PUT',
        body: JSON.stringify({ id: 'rule-1', ruleName: 'Updated' }),
      })
      const response = await PUT(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should update an existing rule', async () => {
      const existingRule = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        ruleId: 'RULE-001',
        ruleName: 'Original Name',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      mockEm.findOne.mockResolvedValue(existingRule)
      mockEm.assign.mockImplementation((target: any, data: any) => Object.assign(target, data))
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'PUT',
        body: JSON.stringify({
          id: '123e4567-e89b-12d3-a456-426614174001',
          ruleName: 'Updated Name',
        }),
      })
      const response = await PUT(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.ok).toBe(true)
      expect(mockEm.findOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: '123e4567-e89b-12d3-a456-426614174001',
          tenantId: validTenantId,
          organizationId: validOrgId,
        })
      )
      expect(mockEm.assign).toHaveBeenCalled()
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
    })

    test('should return 404 if rule not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'PUT',
        body: JSON.stringify({
          id: '999e4567-e89b-12d3-a456-999999999999',
          ruleName: 'Updated',
        }),
      })
      const response = await PUT(request)

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Rule not found')
    })

    test('should return 400 if id is missing', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'PUT',
        body: JSON.stringify({
          ruleName: 'Updated',
        }),
      })
      const response = await PUT(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Rule id is required')
    })

    test('should toggle enabled state via PUT', async () => {
      const existingRule = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        ruleId: 'RULE-001',
        enabled: true,
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      mockEm.findOne.mockResolvedValue(existingRule)
      mockEm.assign.mockImplementation((target: any, data: any) => Object.assign(target, data))
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'PUT',
        body: JSON.stringify({
          id: '123e4567-e89b-12d3-a456-426614174001',
          enabled: false,
        }),
      })
      const response = await PUT(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.ok).toBe(true)
      expect(existingRule.enabled).toBe(false)
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
    })
  })

  describe('DELETE - Delete rule', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/rules?id=rule-1', {
        method: 'DELETE',
      })
      const response = await DELETE(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should soft delete a rule', async () => {
      const existingRule = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        ruleId: 'RULE-001',
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      mockEm.findOne.mockResolvedValue(existingRule)
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/rules?id=rule-1', {
        method: 'DELETE',
      })
      const response = await DELETE(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.ok).toBe(true)
      expect(existingRule.deletedAt).toBeInstanceOf(Date)
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
    })

    test('should return 404 if rule not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/rules?id=nonexistent', {
        method: 'DELETE',
      })
      const response = await DELETE(request)

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Rule not found')
    })

    test('should return 400 if id is missing', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'DELETE',
      })
      const response = await DELETE(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Rule id is required')
    })
  })

  describe('Validation - Condition Expressions', () => {
    test('should reject deeply nested condition expressions (depth > 10)', async () => {
      const deeplyNested = {
        operator: 'AND',
        rules: [{
          operator: 'AND',
          rules: [{
            operator: 'AND',
            rules: [{
              operator: 'AND',
              rules: [{
                operator: 'AND',
                rules: [{
                  operator: 'AND',
                  rules: [{
                    operator: 'AND',
                    rules: [{
                      operator: 'AND',
                      rules: [{
                        operator: 'AND',
                        rules: [{
                          operator: 'AND',
                          rules: [{
                            operator: 'AND',
                            rules: [{ field: 'test', operator: '=', value: 'test' }]
                          }]
                        }]
                      }]
                    }]
                  }]
                }]
              }]
            }]
          }]
        }]
      }

      const newRule = {
        ruleId: 'RULE-DEEP',
        ruleName: 'Deep Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: deeplyNested,
      }

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(newRule),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('safety limits')
    })

    test('should reject condition with invalid field path', async () => {
      const invalidCondition = {
        field: '123invalid',  // Field paths cannot start with numbers
        operator: '=',
        value: 'test'
      }

      const newRule = {
        ruleId: 'RULE-INVALID-FIELD',
        ruleName: 'Invalid Field Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: invalidCondition,
      }

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(newRule),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('Invalid')
    })

    test('should reject condition with invalid operator', async () => {
      const invalidCondition = {
        field: 'status',
        operator: 'IdasdaN',  // Invalid operator
        value: ['ACTIVE', 'PENDING']
      }

      const newRule = {
        ruleId: 'RULE-INVALID-OPERATOR',
        ruleName: 'Invalid Operator Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: invalidCondition,
      }

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(newRule),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('Invalid comparison operator')
      expect(body.error).toContain('IdasdaN')
    })

    test('should reject condition group without rules', async () => {
      const emptyGroup = {
        operator: 'AND',
        rules: []
      }

      const newRule = {
        ruleId: 'RULE-EMPTY',
        ruleName: 'Empty Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: emptyGroup,
      }

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(newRule),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('at least one rule')
    })

    test('should accept valid condition expression', async () => {
      const validCondition = {
        operator: 'AND',
        rules: [
          { field: 'status', operator: '=', value: 'ACTIVE' },
          { field: 'priority', operator: '>', value: 5 }
        ]
      }

      const newRule = {
        ruleId: 'RULE-VALID',
        ruleName: 'Valid Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: validCondition,
      }

      mockEm.create.mockReturnValue({ id: '223e4567-e89b-12d3-a456-426614174003', ...newRule })
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(newRule),
      })
      const response = await POST(request)

      expect(response.status).toBe(201)
    })
  })

  describe('Validation - Actions', () => {
    test('should reject action with missing required config fields', async () => {
      const invalidActions = [
        { type: 'NOTIFY', config: {} }  // Missing 'message' and 'recipients'
      ]

      const newRule = {
        ruleId: 'RULE-INVALID-ACTION',
        ruleName: 'Invalid Action Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: invalidActions,
      }

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(newRule),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('message')
    })

    test('should reject action with invalid type', async () => {
      const invalidActions = [
        { type: 'INVALID_ACTION_TYPE', config: {} }
      ]

      const newRule = {
        ruleId: 'RULE-INVALID-TYPE',
        ruleName: 'Invalid Type Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: invalidActions,
      }

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(newRule),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('Unknown action type')
    })

    test('should accept valid actions', async () => {
      const validActions = [
        { type: 'LOG', config: { message: 'Rule triggered' } },
        { type: 'SET_FIELD', config: { field: 'status', value: 'APPROVED' } }
      ]

      const newRule = {
        ruleId: 'RULE-VALID-ACTIONS',
        ruleName: 'Valid Actions Rule',
        ruleType: 'ACTION',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'PENDING' },
        successActions: validActions,
      }

      mockEm.create.mockReturnValue({ id: '223e4567-e89b-12d3-a456-426614174004', ...newRule })
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(newRule),
      })
      const response = await POST(request)

      expect(response.status).toBe(201)
    })

    test('should validate failureActions separately', async () => {
      const invalidFailureActions = [
        { type: 'CALL_WEBHOOK', config: {} }  // Missing 'url'
      ]

      const newRule = {
        ruleId: 'RULE-INVALID-FAILURE',
        ruleName: 'Invalid Failure Actions',
        ruleType: 'ACTION',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'PENDING' },
        successActions: [{ type: 'LOG', config: { message: 'Success' } }],
        failureActions: invalidFailureActions,
      }

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'POST',
        body: JSON.stringify(newRule),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('url')
    })
  })

  describe('Validation - PUT/Update', () => {
    test('should validate condition expression on update', async () => {
      const invalidCondition = {
        field: '',  // Empty field path
        operator: '=',
        value: 'test'
      }

      const updateData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        conditionExpression: invalidCondition,
      }

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const response = await PUT(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('Invalid')
    })

    test('should validate actions on update', async () => {
      const invalidActions = [
        { type: 'EMIT_EVENT', config: {} }  // Missing 'eventName'
      ]

      const updateData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        successActions: invalidActions,
      }

      const request = new Request('http://localhost:3000/api/business_rules/rules', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const response = await PUT(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('eventName')
    })
  })
})
