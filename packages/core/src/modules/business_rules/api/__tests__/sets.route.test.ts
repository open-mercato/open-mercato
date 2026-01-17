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

type SetsRouteModule = typeof import('../sets/route')
let GET: SetsRouteModule['GET']
let POST: SetsRouteModule['POST']
let PUT: SetsRouteModule['PUT']
let DELETE: SetsRouteModule['DELETE']
let metadata: SetsRouteModule['metadata']

beforeAll(async () => {
  const routeModule = await import('../sets/route')
  GET = routeModule.GET
  POST = routeModule.POST
  PUT = routeModule.PUT
  DELETE = routeModule.DELETE
  metadata = routeModule.metadata
})

describe('Business Rules API - /api/business_rules/sets', () => {
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
      expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['business_rules.manage_sets'] })
      expect(metadata.PUT).toEqual({ requireAuth: true, requireFeatures: ['business_rules.manage_sets'] })
      expect(metadata.DELETE).toEqual({ requireAuth: true, requireFeatures: ['business_rules.manage_sets'] })
    })
  })

  describe('GET - List sets', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/sets')
      const response = await GET(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should return paginated list of sets', async () => {
      const mockSets = [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          setId: 'SET-001',
          setName: 'Manufacturing Rules',
          description: 'Rules for manufacturing operations',
          enabled: true,
          tenantId: validTenantId,
          organizationId: validOrgId,
          createdBy: 'user-1',
          updatedBy: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ]

      mockEm.findAndCount.mockResolvedValue([mockSets, 1])

      const request = new Request('http://localhost:3000/api/business_rules/sets?page=1&pageSize=50')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items).toHaveLength(1)
      expect(body.total).toBe(1)
      expect(body.totalPages).toBe(1)
      expect(body.items[0].setId).toBe('SET-001')
    })

    test('should filter by enabled status', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/sets?enabled=true')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: true }),
        expect.anything()
      )
    })

    test('should search by set name', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/sets?search=manufacturing')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ setName: { $ilike: '%manufacturing%' } }),
        expect.anything()
      )
    })

    test('should filter by setId', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new Request('http://localhost:3000/api/business_rules/sets?setId=SET-001')
      await GET(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ setId: { $ilike: '%SET-001%' } }),
        expect.anything()
      )
    })
  })

  describe('POST - Create set', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/sets', {
        method: 'POST',
        body: JSON.stringify({ setId: 'SET-NEW', setName: 'New Set' }),
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should create a new rule set', async () => {
      const newSet = {
        setId: 'SET-NEW',
        setName: 'New Rule Set',
        description: 'Test set',
        enabled: true,
      }

      mockEm.create.mockReturnValue({ id: '223e4567-e89b-12d3-a456-426614174002', ...newSet })
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/sets', {
        method: 'POST',
        body: JSON.stringify(newSet),
      })
      const response = await POST(request)

      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.id).toBe('223e4567-e89b-12d3-a456-426614174002')
      expect(mockEm.create).toHaveBeenCalled()
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
    })

    test('should inject tenantId and organizationId from auth', async () => {
      const newSet = {
        setId: 'SET-NEW',
        setName: 'New Set',
      }

      mockEm.create.mockReturnValue({ id: '223e4567-e89b-12d3-a456-426614174002', ...newSet })
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/sets', {
        method: 'POST',
        body: JSON.stringify(newSet),
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

    test('should return 400 for invalid set data', async () => {
      const invalidSet = {
        setId: '',
        setName: 'Test',
      }

      const request = new Request('http://localhost:3000/api/business_rules/sets', {
        method: 'POST',
        body: JSON.stringify(invalidSet),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('Validation failed')
    })
  })

  describe('PUT - Update set', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/sets', {
        method: 'PUT',
        body: JSON.stringify({ id: 'set-1', setName: 'Updated' }),
      })
      const response = await PUT(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should update an existing rule set', async () => {
      const existingSet = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        setId: 'SET-001',
        setName: 'Original Name',
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      mockEm.findOne.mockResolvedValue(existingSet)
      mockEm.assign.mockImplementation((target: any, data: any) => Object.assign(target, data))
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/sets', {
        method: 'PUT',
        body: JSON.stringify({
          id: '123e4567-e89b-12d3-a456-426614174001',
          setName: 'Updated Name',
        }),
      })
      const response = await PUT(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.ok).toBe(true)
      expect(mockEm.findOne).toHaveBeenCalled()
      expect(mockEm.assign).toHaveBeenCalled()
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
    })

    test('should return 404 if set not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/sets', {
        method: 'PUT',
        body: JSON.stringify({
          id: '999e4567-e89b-12d3-a456-999999999999',
          setName: 'Updated',
        }),
      })
      const response = await PUT(request)

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Rule set not found')
    })

    test('should return 400 if id is missing', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/sets', {
        method: 'PUT',
        body: JSON.stringify({
          setName: 'Updated',
        }),
      })
      const response = await PUT(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Rule set id is required')
    })
  })

  describe('DELETE - Delete set', () => {
    test('should return 401 when not authenticated', async () => {
      mockGetAuthFromRequest.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/sets?id=set-1', {
        method: 'DELETE',
      })
      const response = await DELETE(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Unauthorized')
    })

    test('should soft delete a rule set', async () => {
      const existingSet = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        setId: 'SET-001',
        tenantId: validTenantId,
        organizationId: validOrgId,
        deletedAt: null,
      }

      mockEm.findOne.mockResolvedValue(existingSet)
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/business_rules/sets?id=123e4567-e89b-12d3-a456-426614174001', {
        method: 'DELETE',
      })
      const response = await DELETE(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.ok).toBe(true)
      expect(existingSet.deletedAt).toBeInstanceOf(Date)
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
    })

    test('should return 404 if set not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/business_rules/sets?id=999e4567-e89b-12d3-a456-999999999999', {
        method: 'DELETE',
      })
      const response = await DELETE(request)

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Rule set not found')
    })

    test('should return 400 if id is missing', async () => {
      const request = new Request('http://localhost:3000/api/business_rules/sets', {
        method: 'DELETE',
      })
      const response = await DELETE(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('Rule set id is required')
    })
  })
})
