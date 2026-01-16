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

type MembersRouteModule = typeof import('../sets/[id]/members/route')

let POST: MembersRouteModule['POST']
let PUT: MembersRouteModule['PUT']
let DELETE: MembersRouteModule['DELETE']
let metadata: MembersRouteModule['metadata']

beforeAll(async () => {
  const routeModule = await import('../sets/[id]/members/route')
  POST = routeModule.POST
  PUT = routeModule.PUT
  DELETE = routeModule.DELETE
  metadata = routeModule.metadata
})

describe('Business Rules API - Rule Set Members', () => {
  const validSetId = '123e4567-e89b-12d3-a456-426614174001'
  const validTenantId = '123e4567-e89b-12d3-a456-426614174000'
  const validOrgId = '223e4567-e89b-12d3-a456-426614174000'
  const validRuleId = '323e4567-e89b-12d3-a456-426614174002'
  const validMemberId = '423e4567-e89b-12d3-a456-426614174003'

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
      expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['business_rules.manage_sets'] })
      expect(metadata.PUT).toEqual({ requireAuth: true, requireFeatures: ['business_rules.manage_sets'] })
      expect(metadata.DELETE).toEqual({ requireAuth: true, requireFeatures: ['business_rules.manage_sets'] })
    })
  })

  describe('POST - Add rule to set', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members`, {
        method: 'POST',
        body: JSON.stringify({ ruleId: validRuleId }),
      })
      const response = await POST(request, { params: { id: validSetId } })

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should add rule to set', async () => {
      const mockSet = {
        id: validSetId,
        setId: 'SET-001',
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      const mockRule = {
        id: validRuleId,
        ruleId: 'RULE-001',
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      const mockMember = {
        id: validMemberId,
      }

      mockEm.findOne.mockResolvedValueOnce(mockSet)
      mockEm.findOne.mockResolvedValueOnce(mockRule)
      mockEm.findOne.mockResolvedValueOnce(null) // No existing member
      mockEm.create.mockReturnValue(mockMember)
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members`, {
        method: 'POST',
        body: JSON.stringify({ ruleId: validRuleId, sequence: 10, enabled: true }),
      })
      const response = await POST(request, { params: { id: validSetId } })

      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.id).toBe(validMemberId)
      expect(mockEm.create).toHaveBeenCalled()
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
    })

    test('should return 404 if set not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members`, {
        method: 'POST',
        body: JSON.stringify({ ruleId: validRuleId }),
      })
      const response = await POST(request, { params: { id: validSetId } })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Rule set not found')
    })

    test('should return 404 if rule not found', async () => {
      const mockSet = {
        id: validSetId,
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      mockEm.findOne.mockResolvedValueOnce(mockSet)
      mockEm.findOne.mockResolvedValueOnce(null) // Rule not found

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members`, {
        method: 'POST',
        body: JSON.stringify({ ruleId: validRuleId }),
      })
      const response = await POST(request, { params: { id: validSetId } })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Rule not found')
    })

    test('should return 409 if rule already in set', async () => {
      const mockSet = {
        id: validSetId,
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      const mockRule = {
        id: validRuleId,
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      const mockExistingMember = {
        id: validMemberId,
      }

      mockEm.findOne.mockResolvedValueOnce(mockSet)
      mockEm.findOne.mockResolvedValueOnce(mockRule)
      mockEm.findOne.mockResolvedValueOnce(mockExistingMember)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members`, {
        method: 'POST',
        body: JSON.stringify({ ruleId: validRuleId }),
      })
      const response = await POST(request, { params: { id: validSetId } })

      expect(response.status).toBe(409)
      const body = await response.json()
      expect(body.error).toBe('Rule is already a member of this set')
    })

    test('should use default values for sequence and enabled', async () => {
      const mockSet = {
        id: validSetId,
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      const mockRule = {
        id: validRuleId,
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      mockEm.findOne.mockResolvedValueOnce(mockSet)
      mockEm.findOne.mockResolvedValueOnce(mockRule)
      mockEm.findOne.mockResolvedValueOnce(null)
      mockEm.create.mockReturnValue({ id: validMemberId })
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members`, {
        method: 'POST',
        body: JSON.stringify({ ruleId: validRuleId }),
      })
      const response = await POST(request, { params: { id: validSetId } })

      expect(response.status).toBe(201)
    })

    test('should return 400 for invalid set id', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/sets/invalid-id/members', {
        method: 'POST',
        body: JSON.stringify({ ruleId: validRuleId }),
      })
      const response = await POST(request, { params: { id: 'invalid-id' } })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid rule set id')
    })
  })

  describe('PUT - Update member', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members`, {
        method: 'PUT',
        body: JSON.stringify({ memberId: validMemberId, sequence: 5 }),
      })
      const response = await PUT(request, { params: { id: validSetId } })

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should update member sequence', async () => {
      const mockMember = {
        id: validMemberId,
        sequence: 0,
        enabled: true,
      }

      mockEm.findOne.mockResolvedValue(mockMember)
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members`, {
        method: 'PUT',
        body: JSON.stringify({ memberId: validMemberId, sequence: 10 }),
      })
      const response = await PUT(request, { params: { id: validSetId } })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.ok).toBe(true)
      expect(mockMember.sequence).toBe(10)
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
    })

    test('should update member enabled state', async () => {
      const mockMember = {
        id: validMemberId,
        sequence: 0,
        enabled: true,
      }

      mockEm.findOne.mockResolvedValue(mockMember)
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members`, {
        method: 'PUT',
        body: JSON.stringify({ memberId: validMemberId, enabled: false }),
      })
      const response = await PUT(request, { params: { id: validSetId } })

      expect(response.status).toBe(200)
      expect(mockMember.enabled).toBe(false)
    })

    test('should return 404 if member not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members`, {
        method: 'PUT',
        body: JSON.stringify({ memberId: validMemberId, sequence: 5 }),
      })
      const response = await PUT(request, { params: { id: validSetId } })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Member not found')
    })
  })

  describe('DELETE - Remove rule from set', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members?memberId=${validMemberId}`, {
        method: 'DELETE',
      })
      const response = await DELETE(request, { params: { id: validSetId } })

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should remove member from set', async () => {
      const mockMember = {
        id: validMemberId,
      }

      mockEm.findOne.mockResolvedValue(mockMember)
      mockEm.removeAndFlush.mockResolvedValue(undefined)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members?memberId=${validMemberId}`, {
        method: 'DELETE',
      })
      const response = await DELETE(request, { params: { id: validSetId } })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.ok).toBe(true)
      expect(mockEm.removeAndFlush).toHaveBeenCalledWith(mockMember)
    })

    test('should return 404 if member not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members?memberId=${validMemberId}`, {
        method: 'DELETE',
      })
      const response = await DELETE(request, { params: { id: validSetId } })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Member not found')
    })

    test('should return 400 if memberId is missing', async () => {
      const request = new Request(`http://localhost:3000/api/business_rules/sets/${validSetId}/members`, {
        method: 'DELETE',
      })
      const response = await DELETE(request, { params: { id: validSetId } })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Member id is required')
    })

    test('should return 400 for invalid set id', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/sets/invalid-id/members?memberId=123', {
        method: 'DELETE',
      })
      const response = await DELETE(request, { params: { id: 'invalid-id' } })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Invalid rule set id')
    })
  })
})
