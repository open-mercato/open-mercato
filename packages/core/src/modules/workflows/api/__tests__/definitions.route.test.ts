/**
 * Workflow Definitions API Tests
 *
 * Tests all CRUD operations for workflow definitions API
 */

import { NextRequest } from 'next/server'
import { GET as listDefinitions, POST as createDefinition } from '../definitions/route'
import {
  GET as getDefinition,
  PUT as updateDefinition,
  DELETE as deleteDefinition,
} from '../definitions/[id]/route'
import { WorkflowDefinition, WorkflowInstance } from '../../data/entities'

// Mock dependencies
jest.mock('@/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

describe('Workflow Definitions API', () => {
  let mockContainer: any
  let mockEm: any
  let mockAuthContext: any
  let mockRbacService: any

  const testTenantId = 'test-tenant-id'
  const testOrgId = 'test-org-id'
  const testUserId = 'test-user-id'

  beforeEach(() => {
    // Setup mocks
    mockAuthContext = {
      tenantId: testTenantId,
      organizationId: testOrgId,
      userId: testUserId,
    }

    mockRbacService = {
      userHasAllFeatures: jest.fn().mockResolvedValue(true),
    }

    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      persistAndFlush: jest.fn(),
      flush: jest.fn(),
    }

    mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'authContext') return mockAuthContext
        if (name === 'rbacService') return mockRbacService
        return null
      }),
    }

    const { createRequestContainer } = require('@/lib/di/container')
    createRequestContainer.mockResolvedValue(mockContainer)

    const { getAuthFromRequest } = require('@/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({
      sub: testUserId,
      tenantId: testTenantId,
      orgId: testOrgId,
    })

    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: testOrgId,
    })

    jest.clearAllMocks()
  })

  // ============================================================================
  // GET /api/workflows/definitions - List Definitions
  // ============================================================================

  describe('GET /api/workflows/definitions', () => {
    test('should list workflow definitions with default pagination', async () => {
      const mockDefinitions = [
        {
          id: 'def-1',
          workflowId: 'approval-workflow',
          version: 1,
          definition: {},
          enabled: true,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
        {
          id: 'def-2',
          workflowId: 'checkout-workflow',
          version: 1,
          definition: {},
          enabled: true,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
      ]

      mockEm.findAndCount.mockResolvedValue([mockDefinitions, 2])

      const request = new NextRequest('http://localhost/api/workflows/definitions')
      const response = await listDefinitions(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toHaveLength(2)
      expect(data.pagination).toEqual({
        total: 2,
        limit: 50,
        offset: 0,
        hasMore: false,
      })
      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowDefinition,
        expect.objectContaining({
          tenantId: testTenantId,
          organizationId: testOrgId,
          deletedAt: null,
        }),
        expect.any(Object)
      )
    })

    test('should filter by enabled status', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new NextRequest('http://localhost/api/workflows/definitions?enabled=true')
      await listDefinitions(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowDefinition,
        expect.objectContaining({
          enabled: true,
        }),
        expect.any(Object)
      )
    })

    test('should filter by workflowId', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new NextRequest(
        'http://localhost/api/workflows/definitions?workflowId=approval-workflow'
      )
      await listDefinitions(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowDefinition,
        expect.objectContaining({
          workflowId: 'approval-workflow',
        }),
        expect.any(Object)
      )
    })

    test('should search in workflowId and name', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new NextRequest('http://localhost/api/workflows/definitions?search=approval')
      await listDefinitions(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowDefinition,
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ workflowId: { $ilike: '%approval%' } }),
          ]),
        }),
        expect.any(Object)
      )
    })

    test('should support custom pagination', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 100])

      const request = new NextRequest(
        'http://localhost/api/workflows/definitions?limit=20&offset=40'
      )
      const response = await listDefinitions(request)
      const data = await response.json()

      expect(data.pagination).toEqual({
        total: 100,
        limit: 20,
        offset: 40,
        hasMore: true,
      })
      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowDefinition,
        expect.any(Object),
        expect.objectContaining({
          limit: 20,
          offset: 40,
        })
      )
    })

    test('should handle errors gracefully', async () => {
      mockEm.findAndCount.mockRejectedValue(new Error('Database error'))

      const request = new NextRequest('http://localhost/api/workflows/definitions')
      const response = await listDefinitions(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBeDefined()
    })
  })

  // ============================================================================
  // POST /api/workflows/definitions - Create Definition
  // ============================================================================

  describe('POST /api/workflows/definitions', () => {
    const validDefinition = {
      workflowId: 'test-workflow',
      workflowName: 'Test Workflow',
      description: 'A test workflow for unit testing',
      version: 1,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          {
            transitionId: 'start-to-end',
            fromStepId: 'start',
            toStepId: 'end',
            trigger: 'auto',
          },
        ],
      },
      enabled: true,
    }

    test('should create workflow definition successfully', async () => {
      mockEm.findOne.mockResolvedValue(null) // No existing definition
      mockEm.create.mockReturnValue({
        id: 'new-def-id',
        ...validDefinition,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      const request = new NextRequest('http://localhost/api/workflows/definitions', {
        method: 'POST',
        body: JSON.stringify(validDefinition),
      })

      const response = await createDefinition(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.data).toBeDefined()
      expect(data.message).toBe('Workflow definition created successfully')
      expect(mockEm.create).toHaveBeenCalledWith(
        WorkflowDefinition,
        expect.objectContaining({
          workflowId: 'test-workflow',
          version: 1,
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      )
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
    })

    test('should check create permission', async () => {
      const { createRequestContainer } = require('@/lib/di/container')
      const localRbacService = {
        userHasAllFeatures: jest.fn().mockResolvedValue(false),
      }
      const localContainer = {
        resolve: jest.fn((name: string) => {
          if (name === 'em') return mockEm
          if (name === 'authContext') return mockAuthContext
          if (name === 'rbacService') return localRbacService
          return null
        }),
      }
      createRequestContainer.mockResolvedValueOnce(localContainer)

      const request = new NextRequest('http://localhost/api/workflows/definitions', {
        method: 'POST',
        body: JSON.stringify(validDefinition),
      })

      const response = await createDefinition(request)

      expect(response.status).toBe(403)
      expect(localRbacService.userHasAllFeatures).toHaveBeenCalledWith(
        testUserId,
        ['workflows.definitions.create'],
        expect.any(Object)
      )
    })

    test('should validate input schema', async () => {
      const invalidDefinition = {
        workflowId: 'test',
        // Missing version and definition
      }

      const request = new NextRequest('http://localhost/api/workflows/definitions', {
        method: 'POST',
        body: JSON.stringify(invalidDefinition),
      })

      const response = await createDefinition(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation failed')
      expect(data.details).toBeDefined()
    })

    test('should prevent duplicate workflowId + version', async () => {
      mockEm.findOne.mockResolvedValue({
        id: 'existing-def',
        workflowId: 'test-workflow',
        version: 1,
      })

      const request = new NextRequest('http://localhost/api/workflows/definitions', {
        method: 'POST',
        body: JSON.stringify(validDefinition),
      })

      const response = await createDefinition(request)
      const data = await response.json()

      expect(response.status).toBe(409)
      expect(data.error).toContain('already exists')
    })

    test('should handle database errors', async () => {
      mockEm.findOne.mockResolvedValue(null)
      mockEm.create.mockImplementation(() => {
        throw new Error('Database error')
      })

      const request = new NextRequest('http://localhost/api/workflows/definitions', {
        method: 'POST',
        body: JSON.stringify(validDefinition),
      })

      const response = await createDefinition(request)

      expect(response.status).toBe(500)
    })
  })

  // ============================================================================
  // GET /api/workflows/definitions/[id] - Get Definition
  // ============================================================================

  describe('GET /api/workflows/definitions/[id]', () => {
    test('should get workflow definition by id', async () => {
      const mockDefinition = {
        id: 'def-1',
        workflowId: 'test-workflow',
        version: 1,
        definition: {},
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.findOne.mockResolvedValue(mockDefinition)

      const request = new NextRequest('http://localhost/api/workflows/definitions/def-1')
      const response = await getDefinition(request, { params: { id: 'def-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toEqual(mockDefinition)
      expect(mockEm.findOne).toHaveBeenCalledWith(
        WorkflowDefinition,
        expect.objectContaining({
          id: 'def-1',
          tenantId: testTenantId,
          organizationId: testOrgId,
          deletedAt: null,
        })
      )
    })

    test('should return 404 if definition not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/workflows/definitions/non-existent')
      const response = await getDefinition(request, { params: { id: 'non-existent' } })

      expect(response.status).toBe(404)
    })

    test('should enforce tenant isolation', async () => {
      mockEm.findOne.mockResolvedValue(null) // Simulates finding nothing due to tenant mismatch

      const request = new NextRequest('http://localhost/api/workflows/definitions/other-tenant-def')
      const response = await getDefinition(request, { params: { id: 'other-tenant-def' } })

      expect(response.status).toBe(404)
      expect(mockEm.findOne).toHaveBeenCalledWith(
        WorkflowDefinition,
        expect.objectContaining({
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      )
    })
  })

  // ============================================================================
  // PUT /api/workflows/definitions/[id] - Update Definition
  // ============================================================================

  describe('PUT /api/workflows/definitions/[id]', () => {
    const mockDefinition = {
      id: 'def-1',
      workflowId: 'test-workflow',
      version: 1,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          {
            transitionId: 'start-to-end',
            fromStepId: 'start',
            toStepId: 'end',
            trigger: 'auto',
          },
        ],
      },
      enabled: true,
      tenantId: testTenantId,
      organizationId: testOrgId,
      updatedAt: new Date(),
    }

    test('should update workflow definition', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)

      const updates = {
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'middle', stepName: 'Middle', stepType: 'AUTOMATED' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            {
              transitionId: 'start-to-middle',
              fromStepId: 'start',
              toStepId: 'middle',
              trigger: 'auto',
            },
            {
              transitionId: 'middle-to-end',
              fromStepId: 'middle',
              toStepId: 'end',
              trigger: 'auto',
            },
          ],
        },
        enabled: false,
      }

      const request = new NextRequest('http://localhost/api/workflows/definitions/def-1', {
        method: 'PUT',
        body: JSON.stringify(updates),
      })

      const response = await updateDefinition(request, { params: { id: 'def-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.message).toBe('Workflow definition updated successfully')
      expect(mockDefinition.enabled).toBe(false)
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('should check edit permission', async () => {
      const { createRequestContainer } = require('@/lib/di/container')
      const localRbacService = {
        userHasAllFeatures: jest.fn().mockResolvedValue(false),
      }
      const localContainer = {
        resolve: jest.fn((name: string) => {
          if (name === 'em') return mockEm
          if (name === 'authContext') return mockAuthContext
          if (name === 'rbacService') return localRbacService
          return null
        }),
      }
      createRequestContainer.mockResolvedValueOnce(localContainer)

      const request = new NextRequest('http://localhost/api/workflows/definitions/def-1', {
        method: 'PUT',
        body: JSON.stringify({ enabled: false }),
      })

      const response = await updateDefinition(request, { params: { id: 'def-1' } })

      expect(response.status).toBe(403)
      expect(localRbacService.userHasAllFeatures).toHaveBeenCalledWith(
        testUserId,
        ['workflows.definitions.edit'],
        expect.any(Object)
      )
    })

    test('should return 404 if definition not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/workflows/definitions/non-existent', {
        method: 'PUT',
        body: JSON.stringify({ enabled: false }),
      })

      const response = await updateDefinition(request, { params: { id: 'non-existent' } })

      expect(response.status).toBe(404)
    })

    test('should validate update input', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)

      const invalidUpdate = {
        definition: 'not-an-object', // Invalid type
      }

      const request = new NextRequest('http://localhost/api/workflows/definitions/def-1', {
        method: 'PUT',
        body: JSON.stringify(invalidUpdate),
      })

      const response = await updateDefinition(request, { params: { id: 'def-1' } })

      expect(response.status).toBe(400)
    })

    test('should allow partial updates', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)

      const partialUpdate = {
        enabled: false,
        // definition not provided
      }

      const request = new NextRequest('http://localhost/api/workflows/definitions/def-1', {
        method: 'PUT',
        body: JSON.stringify(partialUpdate),
      })

      const response = await updateDefinition(request, { params: { id: 'def-1' } })

      expect(response.status).toBe(200)
      expect(mockDefinition.enabled).toBe(false)
    })
  })

  // ============================================================================
  // DELETE /api/workflows/definitions/[id] - Delete Definition
  // ============================================================================

  describe('DELETE /api/workflows/definitions/[id]', () => {
    const mockDefinition = {
      id: 'def-1',
      workflowId: 'test-workflow',
      version: 1,
      definition: {},
      enabled: true,
      tenantId: testTenantId,
      organizationId: testOrgId,
      deletedAt: null,
      updatedAt: new Date(),
    }

    test('should soft delete workflow definition', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)
      mockEm.count.mockResolvedValue(0) // No active instances

      const request = new NextRequest('http://localhost/api/workflows/definitions/def-1', {
        method: 'DELETE',
      })

      const response = await deleteDefinition(request, { params: { id: 'def-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.message).toBe('Workflow definition deleted successfully')
      expect(mockDefinition.deletedAt).toBeInstanceOf(Date)
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('should check delete permission', async () => {
      const { createRequestContainer } = require('@/lib/di/container')
      const localRbacService = {
        userHasAllFeatures: jest.fn().mockResolvedValue(false),
      }
      const localContainer = {
        resolve: jest.fn((name: string) => {
          if (name === 'em') return mockEm
          if (name === 'authContext') return mockAuthContext
          if (name === 'rbacService') return localRbacService
          return null
        }),
      }
      createRequestContainer.mockResolvedValueOnce(localContainer)

      const request = new NextRequest('http://localhost/api/workflows/definitions/def-1', {
        method: 'DELETE',
      })

      const response = await deleteDefinition(request, { params: { id: 'def-1' } })

      expect(response.status).toBe(403)
      expect(localRbacService.userHasAllFeatures).toHaveBeenCalledWith(
        testUserId,
        ['workflows.definitions.delete'],
        expect.any(Object)
      )
    })

    test('should return 404 if definition not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/workflows/definitions/non-existent', {
        method: 'DELETE',
      })

      const response = await deleteDefinition(request, { params: { id: 'non-existent' } })

      expect(response.status).toBe(404)
    })

    test('should prevent deletion if active instances exist', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)
      mockEm.count.mockResolvedValue(3) // 3 active instances

      const request = new NextRequest('http://localhost/api/workflows/definitions/def-1', {
        method: 'DELETE',
      })

      const response = await deleteDefinition(request, { params: { id: 'def-1' } })
      const data = await response.json()

      expect(response.status).toBe(409)
      expect(data.error).toContain('3 active instance')
      // Don't check deletedAt mutation when deletion is prevented
      expect(mockEm.flush).not.toHaveBeenCalled()
    })

    test('should check for active RUNNING instances', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)
      mockEm.count.mockResolvedValue(0)

      const request = new NextRequest('http://localhost/api/workflows/definitions/def-1', {
        method: 'DELETE',
      })

      await deleteDefinition(request, { params: { id: 'def-1' } })

      expect(mockEm.count).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          definitionId: 'def-1',
          status: { $in: ['RUNNING', 'WAITING'] },
        })
      )
    })

    test('should handle database errors during delete', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)
      mockEm.count.mockRejectedValue(new Error('Database error'))

      const request = new NextRequest('http://localhost/api/workflows/definitions/def-1', {
        method: 'DELETE',
      })

      const response = await deleteDefinition(request, { params: { id: 'def-1' } })

      expect(response.status).toBe(500)
    })
  })

  // ============================================================================
  // Multi-tenant Isolation Tests
  // ============================================================================

  describe('Multi-tenant isolation', () => {
    test('should only return definitions for current tenant in list', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new NextRequest('http://localhost/api/workflows/definitions')
      await listDefinitions(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowDefinition,
        expect.objectContaining({
          tenantId: testTenantId,
          organizationId: testOrgId,
        }),
        expect.any(Object)
      )
    })

    test('should not allow accessing other tenant definitions in get', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/workflows/definitions/other-tenant-def')
      const response = await getDefinition(request, { params: { id: 'other-tenant-def' } })

      expect(response.status).toBe(404)
    })

    test('should not allow updating other tenant definitions', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/workflows/definitions/other-tenant-def', {
        method: 'PUT',
        body: JSON.stringify({ enabled: false }),
      })

      const response = await updateDefinition(request, { params: { id: 'other-tenant-def' } })

      expect(response.status).toBe(404)
    })

    test('should not allow deleting other tenant definitions', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/workflows/definitions/other-tenant-def', {
        method: 'DELETE',
      })

      const response = await deleteDefinition(request, { params: { id: 'other-tenant-def' } })

      expect(response.status).toBe(404)
    })
  })
})
