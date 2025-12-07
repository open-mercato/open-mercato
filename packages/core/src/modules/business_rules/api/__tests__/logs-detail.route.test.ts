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

type LogDetailRouteModule = typeof import('../logs/[id]/route')

let detailGET: LogDetailRouteModule['GET']

beforeAll(async () => {
  const detailModule = await import('../logs/[id]/route')
  detailGET = detailModule.GET
})

describe('Business Rules API - Individual Log Operations', () => {
  const validLogId = '12345'
  const validTenantId = '123e4567-e89b-12d3-a456-426614174000'
  const validOrgId = '223e4567-e89b-12d3-a456-426614174000'
  const validRuleId = '323e4567-e89b-12d3-a456-426614174001'
  const validEntityId = '423e4567-e89b-12d3-a456-426614174002'

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      tenantId: validTenantId,
      orgId: validOrgId,
    })
  })

  describe('GET /api/business_rules/logs/[id] - Get log detail', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request(`http://localhost:3000/api/business_rules/logs/${validLogId}`)
      const response = await detailGET(request, { params: { id: validLogId } })

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should return log detail', async () => {
      const mockLog = {
        id: validLogId,
        rule: {
          id: validRuleId,
          ruleId: 'RULE-001',
          ruleName: 'Test Rule',
          ruleType: 'GUARD',
          entityType: 'WorkOrder',
        },
        entityId: validEntityId,
        entityType: 'WorkOrder',
        executionResult: 'SUCCESS',
        inputContext: { status: 'ACTIVE', quantity: 10 },
        outputContext: { allowed: true, changes: {} },
        errorMessage: null,
        executionTimeMs: 150,
        executedAt: new Date('2024-01-01T10:00:00Z'),
        tenantId: validTenantId,
        organizationId: validOrgId,
        executedBy: 'user-1',
      }

      mockEm.findOne.mockResolvedValue(mockLog)

      const request = new Request(`http://localhost:3000/api/business_rules/logs/${validLogId}`)
      const response = await detailGET(request, { params: { id: validLogId } })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.id).toBe(validLogId)
      expect(body.rule.ruleId).toBe('RULE-001')
      expect(body.rule.ruleName).toBe('Test Rule')
      expect(body.executionResult).toBe('SUCCESS')
      expect(body.inputContext).toEqual({ status: 'ACTIVE', quantity: 10 })
      expect(body.outputContext).toEqual({ allowed: true, changes: {} })
      expect(body.errorMessage).toBeNull()
      expect(body.executionTimeMs).toBe(150)
    })

    test('should return log with error details', async () => {
      const mockLog = {
        id: validLogId,
        rule: {
          id: validRuleId,
          ruleId: 'RULE-002',
          ruleName: 'Failing Rule',
          ruleType: 'VALIDATION',
          entityType: 'WorkOrder',
        },
        entityId: validEntityId,
        entityType: 'WorkOrder',
        executionResult: 'ERROR',
        inputContext: { status: 'INVALID' },
        outputContext: null,
        errorMessage: 'Failed to evaluate condition: Invalid status value',
        executionTimeMs: 75,
        executedAt: new Date('2024-01-01T11:00:00Z'),
        tenantId: validTenantId,
        organizationId: validOrgId,
        executedBy: 'user-2',
      }

      mockEm.findOne.mockResolvedValue(mockLog)

      const request = new Request(`http://localhost:3000/api/business_rules/logs/${validLogId}`)
      const response = await detailGET(request, { params: { id: validLogId } })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.executionResult).toBe('ERROR')
      expect(body.errorMessage).toBe('Failed to evaluate condition: Invalid status value')
      expect(body.outputContext).toBeNull()
    })

    test('should return 404 if log not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/logs/99999')
      const response = await detailGET(request, { params: { id: '99999' } })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Log entry not found')
    })

    test('should return 400 for invalid log id', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/logs/invalid-id')
      const response = await detailGET(request, { params: { id: 'invalid-id' } })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid log id')
    })

    test('should populate rule relationship', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request(`http://localhost:3000/api/business_rules/logs/${validLogId}`)
      await detailGET(request, { params: { id: validLogId } })

      expect(mockEm.findOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ populate: ['rule'] })
      )
    })

    test('should filter by tenant and organization', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request(`http://localhost:3000/api/business_rules/logs/${validLogId}`)
      await detailGET(request, { params: { id: validLogId } })

      expect(mockEm.findOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: validLogId,
          tenantId: validTenantId,
          organizationId: validOrgId,
        }),
        expect.anything()
      )
    })
  })
})
