/** @jest-environment node */

import { describe, test, expect, beforeEach, jest } from '@jest/globals'

type MockEntityManager = {
  findOne: jest.Mock
  find: jest.Mock
}

const mockGetAuthFromRequest = jest.fn()
const mockEm: MockEntityManager = {
  findOne: jest.fn() as jest.Mock,
  find: jest.fn() as jest.Mock,
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

type SetDetailRouteModule = typeof import('../sets/[id]/route')

let detailGET: SetDetailRouteModule['GET']

beforeAll(async () => {
  const detailModule = await import('../sets/[id]/route')
  detailGET = detailModule.GET
})

describe('Business Rules API - Individual Set Operations', () => {
  const validSetId = '123e4567-e89b-12d3-a456-426614174001'
  const validTenantId = '123e4567-e89b-12d3-a456-426614174000'
  const validOrgId = '223e4567-e89b-12d3-a456-426614174000'
  const validRuleId = '323e4567-e89b-12d3-a456-426614174002'

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      tenantId: validTenantId,
      orgId: validOrgId,
    })
  })

  describe('GET /api/business_rules/sets/[id] - Get set detail', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}`)
      const response = await detailGET(request, { params: { id: validSetId } })

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should return set detail with members', async () => {
      const mockSet = {
        id: validSetId,
        setId: 'SET-001',
        setName: 'Manufacturing Rules',
        description: 'Rules for manufacturing',
        enabled: true,
        tenantId: validTenantId,
        organizationId: validOrgId,
        createdBy: 'user-1',
        updatedBy: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }

      const mockMembers = [
        {
          id: '423e4567-e89b-12d3-a456-426614174003',
          rule: {
            id: validRuleId,
            ruleName: 'Test Rule',
            ruleType: 'GUARD',
          },
          sequence: 0,
          enabled: true,
        },
      ]

      mockEm.findOne.mockResolvedValue(mockSet)
      mockEm.find.mockResolvedValue(mockMembers)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}`)
      const response = await detailGET(request, { params: { id: validSetId } })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.id).toBe(validSetId)
      expect(body.setId).toBe('SET-001')
      expect(body.setName).toBe('Manufacturing Rules')
      expect(body.members).toHaveLength(1)
      expect(body.members[0].ruleId).toBe(validRuleId)
    })

    test('should return empty members array for set with no rules', async () => {
      const mockSet = {
        id: validSetId,
        setId: 'SET-002',
        setName: 'Empty Set',
        description: null,
        enabled: true,
        tenantId: validTenantId,
        organizationId: validOrgId,
        createdBy: 'user-1',
        updatedBy: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      }

      mockEm.findOne.mockResolvedValue(mockSet)
      mockEm.find.mockResolvedValue([])

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}`)
      const response = await detailGET(request, { params: { id: validSetId } })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.members).toEqual([])
    })

    test('should return 404 if set not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/sets/999e4567-e89b-12d3-a456-999999999999')
      const response = await detailGET(request, { params: { id: '999e4567-e89b-12d3-a456-999999999999' } })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Rule set not found')
    })

    test('should return 400 for invalid UUID', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/sets/invalid-id')
      const response = await detailGET(request, { params: { id: 'invalid-id' } })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid rule set id')
    })

    test('should populate members with rule details', async () => {
      const mockSet = {
        id: validSetId,
        setId: 'SET-001',
        setName: 'Test Set',
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockEm.findOne.mockResolvedValue(mockSet)
      mockEm.find.mockResolvedValue([])

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}`)
      await detailGET(request, { params: { id: validSetId } })

      expect(mockEm.find).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ populate: ['rule'] })
      )
    })
  })
})
