/** @jest-environment node */

import { describe, test, expect, beforeEach, jest } from '@jest/globals'

type MockEntityManager = {
  findOne: jest.Mock
  create: jest.Mock
  persistAndFlush: jest.Mock
}

const mockGetAuthFromRequest = jest.fn()
const mockEm: MockEntityManager = {
  findOne: jest.fn() as jest.Mock,
  create: jest.fn() as jest.Mock,
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

type DetailRouteModule = typeof import('../rules/[id]/route')

let detailGET: DetailRouteModule['GET']

beforeAll(async () => {
  const detailModule = await import('../rules/[id]/route')
  detailGET = detailModule.GET
})

describe('Business Rules API - Individual Rule Operations', () => {
  const validRuleId = '123e4567-e89b-12d3-a456-426614174001'
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

  describe('GET /api/business_rules/rules/[id] - Get rule detail', () => {

    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request(`http://localhost:3000/api/business_rules/rules/${validRuleId}`)
      const response = await detailGET(request, { params: { id: validRuleId } })

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should return rule detail', async () => {
      const mockRule = {
        id: validRuleId,
        ruleId: 'RULE-001',
        ruleName: 'Test Rule',
        description: 'Test description',
        ruleType: 'GUARD',
        ruleCategory: 'validation',
        entityType: 'WorkOrder',
        eventType: 'beforeSave',
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: [{ type: 'notify', config: { message: 'Success' } }],
        failureActions: null,
        enabled: true,
        priority: 100,
        version: 1,
        effectiveFrom: new Date('2024-01-01'),
        effectiveTo: null,
        tenantId: validTenantId,
        organizationId: validOrgId,
        createdBy: 'user-1',
        updatedBy: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }

      mockEm.findOne.mockResolvedValue(mockRule)

      const request = new Request(`http://localhost:3000/api/business_rules/rules/${validRuleId}`)
      const response = await detailGET(request, { params: { id: validRuleId } })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.id).toBe(validRuleId)
      expect(body.ruleId).toBe('RULE-001')
      expect(body.ruleName).toBe('Test Rule')
      expect(body.conditionExpression).toEqual({ field: 'status', operator: '=', value: 'ACTIVE' })
      expect(body.successActions).toHaveLength(1)
    })

    test('should return 404 if rule not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/rules/999e4567-e89b-12d3-a456-999999999999')
      const response = await detailGET(request, { params: { id: '999e4567-e89b-12d3-a456-999999999999' } })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Rule not found')
    })

    test('should return 400 for invalid UUID', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/rules/invalid-id')
      const response = await detailGET(request, { params: { id: 'invalid-id' } })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid rule id')
    })
  })
})
