/**
 * Workflow Instances API Tests
 *
 * Tests all operations for workflow instances API
 */

import { NextRequest } from 'next/server'
import { GET as listInstances, POST as startInstance } from '../instances/route'
import { GET as getInstance } from '../instances/[id]/route'
import { POST as cancelInstance } from '../instances/[id]/cancel/route'
import { POST as retryInstance } from '../instances/[id]/retry/route'
import { GET as getInstanceEvents } from '../instances/[id]/events/route'
import { WorkflowInstance, WorkflowDefinition, WorkflowEvent } from '../../data/entities'
import * as workflowExecutor from '../../lib/workflow-executor'

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

jest.mock('../../lib/workflow-executor', () => ({
  startWorkflow: jest.fn(),
  executeWorkflow: jest.fn(),
  completeWorkflow: jest.fn(),
  WorkflowExecutionError: class WorkflowExecutionError extends Error {
    constructor(message: string, public code: string, public details?: any) {
      super(message)
      this.name = 'WorkflowExecutionError'
    }
  },
}))

describe('Workflow Instances API', () => {
  let mockContainer: any
  let mockEm: any
  let mockAuthContext: any
  let mockRbacService: any

  const testTenantId = 'test-tenant-id'
  const testOrgId = 'test-org-id'
  const testUserId = 'test-user-id'
  const testInstanceId = 'test-instance-id'
  const testDefinitionId = 'test-definition-id'

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
      refresh: jest.fn(),
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
  // GET /api/workflows/instances - List Instances
  // ============================================================================

  describe('GET /api/workflows/instances', () => {
    test('should list workflow instances with default pagination', async () => {
      const mockInstances = [
        {
          id: testInstanceId,
          workflowId: 'checkout',
          version: 1,
          status: 'RUNNING',
          currentStepId: 'payment',
          context: { cartId: '123' },
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
      ]

      mockEm.findAndCount.mockResolvedValue([mockInstances, 1])

      const request = new NextRequest('http://localhost/api/workflows/instances')
      const response = await listInstances(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toEqual(mockInstances)
      expect(data.pagination).toEqual({
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      })
      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowInstance,
        expect.objectContaining({
          tenantId: testTenantId,
          organizationId: testOrgId,
        }),
        expect.any(Object)
      )
    })

    test('should filter instances by workflowId', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new NextRequest('http://localhost/api/workflows/instances?workflowId=checkout')
      await listInstances(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowInstance,
        expect.objectContaining({
          workflowId: 'checkout',
        }),
        expect.any(Object)
      )
    })

    test('should filter instances by status', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new NextRequest('http://localhost/api/workflows/instances?status=RUNNING')
      await listInstances(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowInstance,
        expect.objectContaining({
          status: 'RUNNING',
        }),
        expect.any(Object)
      )
    })

    test('should filter instances by correlationKey', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new NextRequest('http://localhost/api/workflows/instances?correlationKey=order-123')
      await listInstances(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowInstance,
        expect.objectContaining({
          correlationKey: 'order-123',
        }),
        expect.any(Object)
      )
    })

    test('should filter instances by entityType and entityId', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new NextRequest('http://localhost/api/workflows/instances?entityType=order&entityId=order-123')
      await listInstances(request)

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowInstance,
        expect.objectContaining({
          'metadata.entityType': 'order',
          'metadata.entityId': 'order-123',
        }),
        expect.any(Object)
      )
    })

    test('should support custom pagination', async () => {
      mockEm.findAndCount.mockResolvedValue([[], 100])

      const request = new NextRequest('http://localhost/api/workflows/instances?limit=10&offset=20')
      const response = await listInstances(request)
      const data = await response.json()

      expect(data.pagination).toEqual({
        total: 100,
        limit: 10,
        offset: 20,
        hasMore: true,
      })
    })

    test('should return 401 when not authenticated', async () => {
      const { getAuthFromRequest } = require('@/lib/auth/server')
      getAuthFromRequest.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/workflows/instances')
      const response = await listInstances(request)

      expect(response.status).toBe(401)
    })

    test('should handle database errors', async () => {
      mockEm.findAndCount.mockRejectedValue(new Error('Database error'))

      const request = new NextRequest('http://localhost/api/workflows/instances')
      const response = await listInstances(request)

      expect(response.status).toBe(500)
    })
  })

  // ============================================================================
  // POST /api/workflows/instances - Start Instance
  // ============================================================================

  describe('POST /api/workflows/instances', () => {
    const mockInstance = {
      id: testInstanceId,
      workflowId: 'checkout',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'start',
      context: { cartId: '123' },
      tenantId: testTenantId,
      organizationId: testOrgId,
    }

    const mockExecutionResult = {
      status: 'RUNNING',
      currentStep: 'payment',
      context: { cartId: '123' },
      events: [],
      executionTime: 100,
    }

    test('should start workflow successfully', async () => {
      (workflowExecutor.startWorkflow as jest.Mock).mockResolvedValue(mockInstance);
      (workflowExecutor.executeWorkflow as jest.Mock).mockResolvedValue(mockExecutionResult)

      const request = new NextRequest('http://localhost/api/workflows/instances', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: 'checkout',
          initialContext: { cartId: '123' },
        }),
      })

      const response = await startInstance(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.data.instance).toEqual(mockInstance)
      expect(data.data.execution).toEqual(mockExecutionResult)
      expect(data.message).toBe('Workflow started successfully')
      expect(workflowExecutor.startWorkflow).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          workflowId: 'checkout',
          initialContext: { cartId: '123' },
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      )
    })

    test('should inject initiatedBy from auth context', async () => {
      (workflowExecutor.startWorkflow as jest.Mock).mockResolvedValue(mockInstance);
      (workflowExecutor.executeWorkflow as jest.Mock).mockResolvedValue(mockExecutionResult)

      const request = new NextRequest('http://localhost/api/workflows/instances', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: 'checkout',
          initialContext: {},
        }),
      })

      await startInstance(request)

      expect(workflowExecutor.startWorkflow).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          metadata: expect.objectContaining({
            initiatedBy: testUserId,
          }),
        })
      )
    })

    test('should require create permission', async () => {
      mockRbacService.userHasAllFeatures.mockResolvedValue(false)

      const request = new NextRequest('http://localhost/api/workflows/instances', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: 'checkout',
        }),
      })

      const response = await startInstance(request)

      expect(response.status).toBe(403)
      expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
        testUserId,
        ['workflows.instances.create'],
        expect.any(Object)
      )
    })

    test('should validate input', async () => {
      const request = new NextRequest('http://localhost/api/workflows/instances', {
        method: 'POST',
        body: JSON.stringify({
          // Missing workflowId
          initialContext: {},
        }),
      })

      const response = await startInstance(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation failed')
      expect(data.details).toBeDefined()
    })

    test('should handle workflow definition not found', async () => {
      const error = new workflowExecutor.WorkflowExecutionError(
        'Workflow definition not found',
        'DEFINITION_NOT_FOUND'
      );
      (workflowExecutor.startWorkflow as jest.Mock).mockRejectedValue(error)

      const request = new NextRequest('http://localhost/api/workflows/instances', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: 'nonexistent',
        }),
      })

      const response = await startInstance(request)

      expect(response.status).toBe(404)
    })

    test('should handle disabled workflow definition', async () => {
      const error = new workflowExecutor.WorkflowExecutionError(
        'Workflow definition is disabled',
        'DEFINITION_DISABLED'
      );
      (workflowExecutor.startWorkflow as jest.Mock).mockRejectedValue(error)

      const request = new NextRequest('http://localhost/api/workflows/instances', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: 'checkout',
        }),
      })

      const response = await startInstance(request)

      expect(response.status).toBe(400)
    })

    test('should handle invalid workflow definition', async () => {
      const error = new workflowExecutor.WorkflowExecutionError(
        'Workflow definition must have at least START and END steps',
        'INVALID_DEFINITION'
      );
      (workflowExecutor.startWorkflow as jest.Mock).mockRejectedValue(error)

      const request = new NextRequest('http://localhost/api/workflows/instances', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: 'checkout',
        }),
      })

      const response = await startInstance(request)

      expect(response.status).toBe(400)
    })

    test('should return 401 when not authenticated', async () => {
      const { getAuthFromRequest } = require('@/lib/auth/server')
      getAuthFromRequest.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/workflows/instances', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: 'checkout',
        }),
      })

      const response = await startInstance(request)

      expect(response.status).toBe(401)
    })

    test('should handle generic errors', async () => {
      (workflowExecutor.startWorkflow as jest.Mock).mockRejectedValue(new Error('Database error'))

      const request = new NextRequest('http://localhost/api/workflows/instances', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: 'checkout',
        }),
      })

      const response = await startInstance(request)

      expect(response.status).toBe(500)
    })
  })

  // ============================================================================
  // GET /api/workflows/instances/[id] - Get Instance
  // ============================================================================

  describe('GET /api/workflows/instances/[id]', () => {
    test('should get instance by id', async () => {
      const mockInstance = {
        id: testInstanceId,
        workflowId: 'checkout',
        status: 'RUNNING',
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.findOne.mockResolvedValue(mockInstance)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}`)
      const response = await getInstance(request, { params: Promise.resolve({ id: testInstanceId }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toEqual(mockInstance)
      expect(mockEm.findOne).toHaveBeenCalledWith(
        WorkflowInstance,
        expect.objectContaining({
          id: testInstanceId,
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      )
    })

    test('should return 404 when instance not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}`)
      const response = await getInstance(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(response.status).toBe(404)
    })

    test('should enforce tenant isolation', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}`)
      await getInstance(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(mockEm.findOne).toHaveBeenCalledWith(
        WorkflowInstance,
        expect.objectContaining({
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      )
    })

    test('should return 401 when not authenticated', async () => {
      const { getAuthFromRequest } = require('@/lib/auth/server')
      getAuthFromRequest.mockResolvedValue(null)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}`)
      const response = await getInstance(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(response.status).toBe(401)
    })
  })

  // ============================================================================
  // POST /api/workflows/instances/[id]/cancel - Cancel Instance
  // ============================================================================

  describe('POST /api/workflows/instances/[id]/cancel', () => {
    test('should cancel running instance', async () => {
      const mockInstance = {
        id: testInstanceId,
        workflowId: 'checkout',
        status: 'RUNNING',
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.findOne.mockResolvedValue(mockInstance);
      (workflowExecutor.completeWorkflow as jest.Mock).mockResolvedValue(undefined)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/cancel`, {
        method: 'POST',
      })
      const response = await cancelInstance(request, { params: Promise.resolve({ id: testInstanceId }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.message).toBe('Workflow cancelled successfully')
      expect(workflowExecutor.completeWorkflow).toHaveBeenCalledWith(mockEm, testInstanceId, 'CANCELLED')
      expect(mockEm.refresh).toHaveBeenCalledWith(mockInstance)
    })

    test('should cancel paused instance', async () => {
      const mockInstance = {
        id: testInstanceId,
        status: 'PAUSED',
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.findOne.mockResolvedValue(mockInstance);
      (workflowExecutor.completeWorkflow as jest.Mock).mockResolvedValue(undefined)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/cancel`, {
        method: 'POST',
      })
      const response = await cancelInstance(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(response.status).toBe(200)
    })

    test('should require cancel permission', async () => {
      mockRbacService.userHasAllFeatures.mockResolvedValue(false)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/cancel`, {
        method: 'POST',
      })
      const response = await cancelInstance(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(response.status).toBe(403)
    })

    test('should return 404 when instance not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/cancel`, {
        method: 'POST',
      })
      const response = await cancelInstance(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(response.status).toBe(404)
    })

    test('should reject cancelling completed workflow', async () => {
      const mockInstance = {
        id: testInstanceId,
        status: 'COMPLETED',
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.findOne.mockResolvedValue(mockInstance)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/cancel`, {
        method: 'POST',
      })
      const response = await cancelInstance(request, { params: Promise.resolve({ id: testInstanceId }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Cannot cancel workflow in COMPLETED status')
    })

    test('should reject cancelling failed workflow', async () => {
      const mockInstance = {
        id: testInstanceId,
        status: 'FAILED',
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.findOne.mockResolvedValue(mockInstance)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/cancel`, {
        method: 'POST',
      })
      const response = await cancelInstance(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(response.status).toBe(400)
    })
  })

  // ============================================================================
  // POST /api/workflows/instances/[id]/retry - Retry Instance
  // ============================================================================

  describe('POST /api/workflows/instances/[id]/retry', () => {
    test('should retry failed instance', async () => {
      const mockInstance = {
        id: testInstanceId,
        workflowId: 'checkout',
        status: 'FAILED',
        retryCount: 0,
        tenantId: testTenantId,
        organizationId: testOrgId,
        errorMessage: 'Test error',
        definitionId: 'def-1',
        version: 1,
        currentStepId: 'payment',
        context: {},
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const mockExecutionResult = {
        status: 'RUNNING',
        currentStep: 'payment',
        context: {},
        events: [],
        executionTime: 100,
      }

      mockEm.findOne.mockResolvedValue(mockInstance);
      (workflowExecutor.executeWorkflow as jest.Mock).mockResolvedValue(mockExecutionResult)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/retry`, {
        method: 'POST',
      })
      const response = await retryInstance(request, { params: Promise.resolve({ id: testInstanceId }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.message).toBe('Workflow retry initiated successfully')
      expect(mockInstance.status).toBe('RUNNING')
      expect(mockInstance.retryCount).toBe(1)
      expect(mockInstance.errorMessage).toBeNull()
      expect(mockEm.flush).toHaveBeenCalled()
      expect(workflowExecutor.executeWorkflow).toHaveBeenCalledWith(mockEm, mockContainer, testInstanceId)
    })

    test('should require retry permission', async () => {
      mockRbacService.userHasAllFeatures.mockResolvedValue(false)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/retry`, {
        method: 'POST',
      })
      const response = await retryInstance(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(response.status).toBe(403)
    })

    test('should return 404 when instance not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/retry`, {
        method: 'POST',
      })
      const response = await retryInstance(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(response.status).toBe(404)
    })

    test('should reject retrying non-failed workflow', async () => {
      const mockInstance = {
        id: testInstanceId,
        status: 'RUNNING',
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.findOne.mockResolvedValue(mockInstance)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/retry`, {
        method: 'POST',
      })
      const response = await retryInstance(request, { params: Promise.resolve({ id: testInstanceId }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Cannot retry workflow in RUNNING status')
    })

    test('should handle execution errors during retry', async () => {
      const mockInstance = {
        id: testInstanceId,
        status: 'FAILED',
        retryCount: 0,
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.findOne.mockResolvedValue(mockInstance)
      const error = new workflowExecutor.WorkflowExecutionError('Execution failed', 'EXECUTION_ERROR');
      (workflowExecutor.executeWorkflow as jest.Mock).mockRejectedValue(error)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/retry`, {
        method: 'POST',
      })
      const response = await retryInstance(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(response.status).toBe(400)
    })
  })

  // ============================================================================
  // GET /api/workflows/instances/[id]/events - Get Instance Events
  // ============================================================================

  describe('GET /api/workflows/instances/[id]/events', () => {
    const mockInstance = {
      id: testInstanceId,
      tenantId: testTenantId,
      organizationId: testOrgId,
    }

    test('should get events for instance', async () => {
      const testDate = new Date('2025-01-01T00:00:00Z')
      const mockEvents = [
        {
          id: 'event-1',
          workflowInstanceId: testInstanceId,
          eventType: 'WORKFLOW_STARTED',
          eventData: {},
          occurredAt: testDate,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
        {
          id: 'event-2',
          workflowInstanceId: testInstanceId,
          eventType: 'TRANSITION_EXECUTED',
          eventData: {},
          occurredAt: testDate,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
      ]

      mockEm.findOne.mockResolvedValue(mockInstance)
      mockEm.findAndCount.mockResolvedValue([mockEvents, 2])

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/events`)
      const response = await getInstanceEvents(request, { params: Promise.resolve({ id: testInstanceId }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toHaveLength(2)
      expect(data.data[0].eventType).toBe('WORKFLOW_STARTED')
      expect(data.data[1].eventType).toBe('TRANSITION_EXECUTED')
      expect(data.pagination.total).toBe(2)
      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.objectContaining({
          workflowInstanceId: testInstanceId,
          tenantId: testTenantId,
          organizationId: testOrgId,
        }),
        expect.objectContaining({
          orderBy: { occurredAt: 'DESC' },
        })
      )
    })

    test('should filter events by eventType', async () => {
      mockEm.findOne.mockResolvedValue(mockInstance)
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/events?eventType=TRANSITION_EXECUTED`)
      await getInstanceEvents(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.objectContaining({
          eventType: 'TRANSITION_EXECUTED',
        }),
        expect.any(Object)
      )
    })

    test('should support pagination', async () => {
      mockEm.findOne.mockResolvedValue(mockInstance)
      mockEm.findAndCount.mockResolvedValue([[], 200])

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/events?limit=20&offset=40`)
      const response = await getInstanceEvents(request, { params: Promise.resolve({ id: testInstanceId }) })
      const data = await response.json()

      expect(data.pagination).toEqual({
        total: 200,
        limit: 20,
        offset: 40,
        hasMore: true,
      })
    })

    test('should return 404 when instance not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/events`)
      const response = await getInstanceEvents(request, { params: Promise.resolve({ id: testInstanceId }) })

      expect(response.status).toBe(404)
    })

    test('should enforce tenant isolation', async () => {
      mockEm.findOne.mockResolvedValue(mockInstance)
      mockEm.findAndCount.mockResolvedValue([[], 0])

      const request = new NextRequest(`http://localhost/api/workflows/instances/${testInstanceId}/events`)
      await getInstanceEvents(request, { params: Promise.resolve({ id: testInstanceId }) })

      // Verify instance lookup uses tenant context
      expect(mockEm.findOne).toHaveBeenCalledWith(
        WorkflowInstance,
        expect.objectContaining({
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      )

      // Verify events query uses tenant context
      expect(mockEm.findAndCount).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.objectContaining({
          tenantId: testTenantId,
          organizationId: testOrgId,
        }),
        expect.any(Object)
      )
    })
  })
})
