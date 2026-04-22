import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import * as workflowExecutor from '../workflow-executor'
import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowEvent,
} from '../../data/entities'

describe('Workflow Executor (Unit Tests)', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>

  const testTenantId = '00000000-0000-4000-8000-000000000001'
  const testOrgId = '00000000-0000-4000-8000-000000000002'
  const testDefinitionId = '00000000-0000-4000-8000-000000000003'
  const testInstanceId = '00000000-0000-4000-8000-000000000004'

  // Mock workflow definition with simple START -> END flow
  const mockDefinition: Partial<WorkflowDefinition> = {
    id: testDefinitionId,
    workflowId: 'simple-workflow',
    workflowName: 'Simple Workflow',
    version: 1,
    enabled: true,
    definition: {
      steps: [
        {
          stepId: 'start',
          stepName: 'Start',
          stepType: 'START',
        },
        {
          stepId: 'end',
          stepName: 'End',
          stepType: 'END',
        },
      ],
      transitions: [
        {
          transitionId: 'start-to-end',
          fromStepId: 'start',
          toStepId: 'end',
          trigger: 'auto',
          priority: 0,
        },
      ],
    },
    tenantId: testTenantId,
    organizationId: testOrgId,
  }

  beforeEach(() => {
    // Create mock EntityManager
    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      persistAndFlush: jest.fn(),
      flush: jest.fn(),
      nativeDelete: jest.fn(),
    } as any

    // Create mock DI Container
    mockContainer = {
      resolve: jest.fn(),
    } as any

    // Reset all mocks
    jest.clearAllMocks()
  })

  // ============================================================================
  // startWorkflow() Tests
  // ============================================================================

  describe('startWorkflow', () => {
    test('should start workflow successfully', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition as WorkflowDefinition)

      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'RUNNING',
        currentStepId: 'start',
        context: { initialData: 'test' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.create.mockReturnValue(mockInstance)

      const instance = await workflowExecutor.startWorkflow(mockEm, {
        workflowId: 'simple-workflow',
        initialContext: { initialData: 'test' },
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(instance).toBeDefined()
      expect(instance.workflowId).toBe('simple-workflow')
      expect(instance.status).toBe('RUNNING')
      expect(instance.currentStepId).toBe('start')
      expect(mockEm.create).toHaveBeenCalled()
      expect(mockEm.persistAndFlush).toHaveBeenCalledWith(mockInstance)
    })

    test('should throw error if definition not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      await expect(
        workflowExecutor.startWorkflow(mockEm, {
          workflowId: 'non-existent',
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      ).rejects.toThrow('Workflow definition not found')
    })

    test('should throw error if definition is disabled', async () => {
      const disabledDefinition = {
        ...mockDefinition,
        enabled: false,
      }
      mockEm.findOne.mockResolvedValue(disabledDefinition as WorkflowDefinition)

      await expect(
        workflowExecutor.startWorkflow(mockEm, {
          workflowId: 'simple-workflow',
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      ).rejects.toThrow('Workflow definition is disabled')
    })

    test('should throw error if definition has no steps', async () => {
      const invalidDefinition = {
        ...mockDefinition,
        definition: {
          steps: [],
          transitions: [],
        },
      }
      mockEm.findOne.mockResolvedValue(invalidDefinition as WorkflowDefinition)

      await expect(
        workflowExecutor.startWorkflow(mockEm, {
          workflowId: 'simple-workflow',
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      ).rejects.toThrow('Workflow definition must have at least START and END steps')
    })

    test('should throw error if definition has no transitions', async () => {
      const invalidDefinition = {
        ...mockDefinition,
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [],
        },
      }
      mockEm.findOne.mockResolvedValue(invalidDefinition as WorkflowDefinition)

      await expect(
        workflowExecutor.startWorkflow(mockEm, {
          workflowId: 'simple-workflow',
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      ).rejects.toThrow('Workflow definition must have at least one transition')
    })

    test('should throw error if definition has no START step', async () => {
      const invalidDefinition = {
        ...mockDefinition,
        definition: {
          steps: [
            { stepId: 'step1', stepName: 'Step 1', stepType: 'AUTOMATED' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            {
              transitionId: 'step1-to-end',
              fromStepId: 'step1',
              toStepId: 'end',
              trigger: 'auto',
              priority: 0,
            },
          ],
        },
      }
      mockEm.findOne.mockResolvedValue(invalidDefinition as WorkflowDefinition)

      await expect(
        workflowExecutor.startWorkflow(mockEm, {
          workflowId: 'simple-workflow',
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      ).rejects.toThrow('Workflow definition must have a START step')
    })

    test('should support correlation key', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition as WorkflowDefinition)

      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'RUNNING',
        currentStepId: 'start',
        context: {},
        correlationKey: 'order-12345',
        tenantId: testTenantId,
        organizationId: testOrgId,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.create.mockReturnValue(mockInstance)

      const instance = await workflowExecutor.startWorkflow(mockEm, {
        workflowId: 'simple-workflow',
        correlationKey: 'order-12345',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(instance.correlationKey).toBe('order-12345')
    })

    test('should support metadata', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition as WorkflowDefinition)

      const metadata = {
        entityType: 'Order',
        entityId: '12345',
        initiatedBy: 'user@example.com',
      }

      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'RUNNING',
        currentStepId: 'start',
        context: {},
        metadata,
        tenantId: testTenantId,
        organizationId: testOrgId,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.create.mockReturnValue(mockInstance)

      const instance = await workflowExecutor.startWorkflow(mockEm, {
        workflowId: 'simple-workflow',
        metadata,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(instance.metadata).toEqual(metadata)
    })

    test('should find latest enabled version if no version specified', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition as WorkflowDefinition)

      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'RUNNING',
        currentStepId: 'start',
        context: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as WorkflowInstance

      mockEm.create.mockReturnValue(mockInstance)

      await workflowExecutor.startWorkflow(mockEm, {
        workflowId: 'simple-workflow',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      // Should search for enabled definition with DESC ordering
      const callArgs = mockEm.findOne.mock.calls[0]
      expect(callArgs[0]).toEqual(expect.any(Function))
      expect(callArgs[1]).toMatchObject({
        workflowId: 'simple-workflow',
        tenantId: testTenantId,
        organizationId: testOrgId,
        enabled: true,
        deletedAt: null,
      })
      expect(callArgs[2]).toEqual({ orderBy: { version: 'DESC' } })
    })
  })

  // ============================================================================
  // executeWorkflow() Tests
  // ============================================================================

  describe('executeWorkflow', () => {
    test('should execute workflow at END step and complete it', async () => {
      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'RUNNING',
        currentStepId: 'end', // Already at END step
        context: { data: 'test' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.findOne
        .mockResolvedValueOnce(mockInstance) // First call: get instance in executeWorkflow
        .mockResolvedValueOnce(mockDefinition as WorkflowDefinition) // Second call: get definition
        .mockResolvedValueOnce(mockInstance) // Third call: refresh instance in executeWorkflow
        .mockResolvedValueOnce(mockInstance) // Fourth call: get instance in completeWorkflow
        .mockResolvedValueOnce(mockDefinition as WorkflowDefinition) // Fifth call: get definition in completeWorkflow for compensation check

      const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)

      expect(result.status).toBe('COMPLETED')
      expect(result.currentStep).toBe('end')
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
    })

    test('should return RUNNING status if not at END step', async () => {
      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'RUNNING',
        currentStepId: 'start', // At START step
        context: { data: 'test' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.findOne
        .mockResolvedValueOnce(mockInstance) // First call: get instance in executeWorkflow
        .mockResolvedValueOnce(mockDefinition as WorkflowDefinition) // Second call: get definition
        .mockResolvedValueOnce(mockInstance) // Third call: refresh instance in executeWorkflow

      const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)

      expect(result.status).toBe('RUNNING')
      expect(result.currentStep).toBe('start')
    })

    test('should throw error if instance not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      await expect(
        workflowExecutor.executeWorkflow(mockEm, mockContainer, 'non-existent-id')
      ).rejects.toThrow('Workflow instance not found')
    })

    test('should handle already completed workflow', async () => {
      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'COMPLETED',
        currentStepId: 'end',
        context: { data: 'test' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        completedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.findOne.mockResolvedValue(mockInstance)

      const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)

      expect(result.status).toBe('COMPLETED')
      expect(result.executionTime).toBe(0)
    })

    test('should throw error for cancelled workflow', async () => {
      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'CANCELLED',
        currentStepId: 'start',
        context: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        cancelledAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.findOne.mockResolvedValue(mockInstance)

      await expect(
        workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)
      ).rejects.toThrow('Cannot execute cancelled workflow')
    })

    test('should throw error if definition not found', async () => {
      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'RUNNING',
        currentStepId: 'start',
        context: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.findOne
        .mockResolvedValueOnce(mockInstance)
        .mockResolvedValueOnce(null) // Definition not found

      await expect(
        workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)
      ).rejects.toThrow('Workflow definition not found')
    })
  })

  // ============================================================================
  // completeWorkflow() Tests
  // ============================================================================

  describe('completeWorkflow', () => {
    test('should complete workflow with COMPLETED status', async () => {
      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'RUNNING',
        currentStepId: 'end',
        context: { data: 'test' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.findOne.mockResolvedValue(mockInstance)

      await workflowExecutor.completeWorkflow(mockEm, mockContainer, testInstanceId, 'COMPLETED', {
        finalResult: 'success',
      })

      expect(mockInstance.status).toBe('COMPLETED')
      expect(mockInstance.completedAt).toBeDefined()
      expect(mockInstance.context.__result).toEqual({ finalResult: 'success' })
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('should complete workflow with FAILED status', async () => {
      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'RUNNING',
        currentStepId: 'step1',
        context: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.findOne
        .mockResolvedValueOnce(mockInstance) // First call: get instance
        .mockResolvedValueOnce(mockDefinition as WorkflowDefinition) // Second call: get definition for compensation check

      await workflowExecutor.completeWorkflow(mockEm, mockContainer, testInstanceId, 'FAILED', {
        error: 'Something went wrong',
        details: { code: 'ERROR_CODE' },
      })

      expect(mockInstance.status).toBe('FAILED')
      expect(mockInstance.completedAt).toBeDefined()
      expect(mockInstance.errorMessage).toBe('Something went wrong')
      expect(mockInstance.errorDetails).toEqual({ code: 'ERROR_CODE' })
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('should complete workflow with CANCELLED status', async () => {
      const mockInstance = {
        id: testInstanceId,
        definitionId: testDefinitionId,
        workflowId: 'simple-workflow',
        version: 1,
        status: 'RUNNING',
        currentStepId: 'step1',
        context: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.findOne.mockResolvedValue(mockInstance)

      await workflowExecutor.completeWorkflow(mockEm, mockContainer, testInstanceId, 'CANCELLED')

      expect(mockInstance.status).toBe('CANCELLED')
      expect(mockInstance.cancelledAt).toBeDefined()
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('should throw error if instance not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      await expect(
        workflowExecutor.completeWorkflow(mockEm, mockContainer, 'non-existent-id', 'COMPLETED')
      ).rejects.toThrow('Workflow instance not found')
    })
  })

  // ============================================================================
  // Helper Functions Tests
  // ============================================================================

  describe('getWorkflowInstance', () => {
    test('should get workflow instance by ID', async () => {
      const mockInstance = {
        id: testInstanceId,
        workflowId: 'simple-workflow',
        status: 'RUNNING',
        definitionId: testDefinitionId,
        version: 1,
        currentStepId: 'start',
        context: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.findOne.mockResolvedValue(mockInstance)

      const instance = await workflowExecutor.getWorkflowInstance(mockEm, testInstanceId)

      expect(instance).toBeDefined()
      expect(instance?.id).toBe(testInstanceId)
      const findOneCall = mockEm.findOne.mock.calls[0]
      expect(findOneCall[0]).toEqual(expect.any(Function))
      expect(findOneCall[1]).toEqual({ id: testInstanceId })
    })

    test('should return null if instance not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const instance = await workflowExecutor.getWorkflowInstance(mockEm, 'non-existent-id')

      expect(instance).toBeNull()
    })
  })

  describe('updateWorkflowContext', () => {
    test('should update workflow context', async () => {
      const mockInstance = {
        id: testInstanceId,
        workflowId: 'simple-workflow',
        status: 'RUNNING',
        context: { existingKey: 'existingValue' },
        definitionId: testDefinitionId,
        version: 1,
        currentStepId: 'start',
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.findOne.mockResolvedValue(mockInstance)

      await workflowExecutor.updateWorkflowContext(mockEm, testInstanceId, {
        newKey: 'newValue',
      })

      expect(mockInstance.context).toEqual({
        existingKey: 'existingValue',
        newKey: 'newValue',
      })
      expect(mockInstance.updatedAt).toBeDefined()
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('should throw error if instance not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      await expect(
        workflowExecutor.updateWorkflowContext(mockEm, 'non-existent-id', { key: 'value' })
      ).rejects.toThrow('Workflow instance not found')
    })

    test('should merge context updates with existing context', async () => {
      const mockInstance = {
        id: testInstanceId,
        workflowId: 'simple-workflow',
        status: 'RUNNING',
        context: { key1: 'value1', key2: 'value2' },
        definitionId: testDefinitionId,
        version: 1,
        currentStepId: 'start',
        tenantId: testTenantId,
        organizationId: testOrgId,
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as WorkflowInstance

      mockEm.findOne.mockResolvedValue(mockInstance)

      await workflowExecutor.updateWorkflowContext(mockEm, testInstanceId, {
        key2: 'updatedValue2',
        key3: 'value3',
      })

      expect(mockInstance.context).toEqual({
        key1: 'value1',
        key2: 'updatedValue2',
        key3: 'value3',
      })
    })
  })
})
