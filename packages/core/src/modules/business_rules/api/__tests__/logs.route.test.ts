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

type LogsRouteModule = typeof import('../logs/route')
let GET: LogsRouteModule['GET']
let metadata: LogsRouteModule['metadata']

beforeAll(async () => {
  const routeModule = await import('../logs/route')
  GET = routeModule.GET
  metadata = routeModule.metadata
})

describe('Business Rules API - /api/business_rules/logs', () => {
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

  describe('Metadata', () => {
    test('should have correct RBAC requirements', () => {
      expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['business_rules.view_logs'] })
    })
  })

  describe('GET - List logs', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/logs')
      const response = await GET(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should return paginated list of logs', async () => {
      const mockLogs = [
        {
          id: '1',
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
          inputContext: { status: 'ACTIVE' },
          outputContext: { allowed: true },
          errorMessage: null,
          executionTimeMs: 150,
          executedAt: new Date('2024-01-01T10:00:00Z'),
          tenantId: validTenantId,
          organizationId: validOrgId,
          executedBy: 'user-1',
        },
      ]

      mockEm.findAndCount.mockResolvedValue([mockLogs, 1])

      const request = new Request('http://localhost:3000/api/business_rules/logs?page=1&pageSize=50')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items).toHaveLength(1)
      expect(body.total).toBe(1)
      expect(body.totalPages).toBe(1)
      expect(body.items[0].id).toBe('1')
      expect(body.items[0].ruleName).toBe('Test Rule')
      expect(body.items[0].executionResult).toBe('SUCCESS')
    })

    test('should filter by ruleId', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request(`http://localhost:3000/api/business_rules/logs?ruleId=${validRuleId}`)
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ rule: { id: validRuleId } }),
        expect.anything()
      )
    })

    test('should filter by entityId', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request(`http://localhost:3000/api/business_rules/logs?entityId=${validEntityId}`)
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ entityId: validEntityId }),
        expect.anything()
      )
    })

    test('should filter by entityType', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/logs?entityType=WorkOrder')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ entityType: 'WorkOrder' }),
        expect.anything()
      )
    })

    test('should filter by executionResult', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/logs?executionResult=ERROR')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ executionResult: 'ERROR' }),
        expect.anything()
      )
    })

    test('should filter by executedBy', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/logs?executedBy=user-1')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ executedBy: 'user-1' }),
        expect.anything()
      )
    })

    test('should filter by date range', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const fromDate = '2024-01-01T00:00:00Z'
      const toDate = '2024-01-31T23:59:59Z'
      const request = new Request(`http://localhost:3000/api/business_rules/logs?executedAtFrom=${fromDate}&executedAtTo=${toDate}`)
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          executedAt: expect.objectContaining({
            $gte: expect.any(Date),
            $lte: expect.any(Date),
          }),
        }),
        expect.anything()
      )
    })

    test('should handle empty results', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/logs')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items).toHaveLength(0)
      expect(body.total).toBe(0)
      expect(body.totalPages).toBe(1)
    })

    test('should populate rule details', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/logs')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ populate: ['rule'] })
      )
    })

    test('should sort by executedAt desc by default', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/logs')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ orderBy: { executedAt: 'desc' } })
      )
    })

    test('should allow custom sorting', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/logs?sortField=executionTimeMs&sortDir=asc')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ orderBy: { executionTimeMs: 'asc' } })
      )
    })

    test('should handle pagination', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/logs?page=3&pageSize=25')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ limit: 25, offset: 50 })
      )
    })

    test('should return 400 for invalid query parameters', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/logs?page=invalid')
      const response = await GET(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid query parameters')
    })
  })
})
