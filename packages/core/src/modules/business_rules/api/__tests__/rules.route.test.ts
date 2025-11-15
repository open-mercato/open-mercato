/** @jest-environment node */

import { describe, test, expect, beforeEach, jest } from '@jest/globals'

type MockEntityManager = {
  findOne: jest.Mock
  find: jest.Mock
  findAndCount: jest.Mock
  create: jest.Mock
  assign: jest.Mock
  persistAndFlush: jest.Mock
}

const mockGetAuthFromRequest = jest.fn()
const mockEm: MockEntityManager = {
  findOne: jest.fn() as jest.Mock,
  find: jest.fn() as jest.Mock,
  findAndCount: jest.fn() as jest.Mock,
  create: jest.fn() as jest.Mock,
  assign: jest.fn() as jest.Mock,
  persistAndFlush: jest.fn() as jest.Mock,
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    return undefined
  }),
}

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
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
      mockEm.assign.mockImplementation((target, data) => Object.assign(target, data))
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
      mockEm.assign.mockImplementation((target, data) => Object.assign(target, data))
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
})
