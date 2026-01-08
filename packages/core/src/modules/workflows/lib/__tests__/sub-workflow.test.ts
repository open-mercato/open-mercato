/**
 * Sub-Workflow Tests (Phase 8, Step 8.1)
 *
 * Tests for sub-workflow execution functionality including:
 * - Basic sub-workflow invocation
 * - Input/output data mapping
 * - Error propagation
 * - Multi-tenant isolation
 * - Event logging
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import * as stepHandler from '../step-handler'
import * as workflowExecutor from '../workflow-executor'
import type {
  WorkflowDefinition,
  WorkflowInstance,
  StepInstance,
  WorkflowEvent,
} from '../../data/entities'

describe('Sub-Workflow Execution (Phase 8)', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>

  const testTenantId = '00000000-0000-4000-8000-000000000001'
  const testOrgId = '00000000-0000-4000-8000-000000000002'
  const parentDefinitionId = '00000000-0000-4000-8000-000000000003'
  const parentInstanceId = '00000000-0000-4000-8000-000000000004'
  const childDefinitionId = '00000000-0000-4000-8000-000000000005'
  const childInstanceId = '00000000-0000-4000-8000-000000000006'
  const stepInstanceId = '00000000-0000-4000-8000-000000000007'

  // Parent workflow definition with SUB_WORKFLOW step
  const parentDefinition: Partial<WorkflowDefinition> = {
    id: parentDefinitionId,
    workflowId: 'parent-workflow',
    workflowName: 'Parent Workflow',
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
          stepId: 'invoke-child',
          stepName: 'Invoke Child Workflow',
          stepType: 'SUB_WORKFLOW',
          config: {
            subWorkflowId: 'child-workflow',
            version: 1,
            inputMapping: {
              childOrderId: 'orderId',
              childAmount: 'amount',
            },
            outputMapping: {
              result: 'status',
              timestamp: 'completedAt',
            },
          },
        },
        {
          stepId: 'end',
          stepName: 'End',
          stepType: 'END',
        },
      ],
      transitions: [],
    },
    tenantId: testTenantId,
    organizationId: testOrgId,
  }

  // Child workflow definition
  const childDefinition: Partial<WorkflowDefinition> = {
    id: childDefinitionId,
    workflowId: 'child-workflow',
    workflowName: 'Child Workflow',
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
          stepId: 'process',
          stepName: 'Process',
          stepType: 'AUTOMATED',
        },
        {
          stepId: 'end',
          stepName: 'End',
          stepType: 'END',
        },
      ],
      transitions: [],
    },
    tenantId: testTenantId,
    organizationId: testOrgId,
  }

  const parentInstance: Partial<WorkflowInstance> = {
    id: parentInstanceId,
    definitionId: parentDefinitionId,
    workflowId: 'parent-workflow',
    version: 1,
    status: 'RUNNING',
    currentStepId: 'invoke-child',
    context: {
      orderId: '12345',
      amount: 100,
      customerEmail: 'test@example.com',
    },
    tenantId: testTenantId,
    organizationId: testOrgId,
    startedAt: new Date(),
  }

  const childInstance: Partial<WorkflowInstance> = {
    id: childInstanceId,
    definitionId: childDefinitionId,
    workflowId: 'child-workflow',
    version: 1,
    status: 'COMPLETED',
    currentStepId: 'end',
    context: {
      childOrderId: '12345',
      childAmount: 100,
      status: 'SUCCESS',
      completedAt: '2024-01-08T12:00:00Z',
    },
    tenantId: testTenantId,
    organizationId: testOrgId,
    startedAt: new Date(),
    completedAt: new Date(),
  }

  const stepInstance: Partial<StepInstance> = {
    id: stepInstanceId,
    workflowInstanceId: parentInstanceId,
    stepId: 'invoke-child',
    stepName: 'Invoke Child Workflow',
    stepType: 'SUB_WORKFLOW',
    status: 'ACTIVE',
    tenantId: testTenantId,
    organizationId: testOrgId,
  }

  beforeEach(() => {
    // Create mock EntityManager
    mockEm = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      persistAndFlush: jest.fn(),
      flush: jest.fn(),
    } as any

    // Create mock container
    mockContainer = {} as any

    // Reset all mocks
    jest.clearAllMocks()

    // Setup default mock implementations
    mockEm.create.mockImplementation((entity: any, data: any) => ({ ...data, id: childInstanceId } as any))
    mockEm.persistAndFlush.mockResolvedValue(undefined as any)
    mockEm.flush.mockResolvedValue(undefined as any)
  })

  // ============================================================================
  // Basic Functionality Tests
  // ============================================================================

  describe('Basic Sub-Workflow Execution', () => {
    test('should start sub-workflow from parent', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: childInstance.context!,
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      const result = await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      expect(startWorkflowSpy).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          workflowId: 'child-workflow',
          version: 1,
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      )
      expect(executeWorkflowSpy).toHaveBeenCalledWith(mockEm, mockContainer, childInstanceId, expect.any(Object))
      expect(result.status).toBe('COMPLETED')

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })

    test('should pass input data to sub-workflow with mapping', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: childInstance.context!,
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      const startCall = startWorkflowSpy.mock.calls[0]
      const initialContext = startCall[1].initialContext

      expect(initialContext).toEqual({
        childOrderId: '12345',
        childAmount: 100,
      })

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })

    test('should return output data to parent with mapping', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: childInstance.context!,
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      const result = await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      expect(result.status).toBe('COMPLETED')
      expect(result.outputData).toEqual({
        result: 'SUCCESS',
        timestamp: '2024-01-08T12:00:00Z',
      })

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })

    test('should complete parent step after child workflow completes', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: childInstance.context!,
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      const result = await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      expect(result.status).toBe('COMPLETED')
      expect(result.outputData).toBeDefined()

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })
  })

  // ============================================================================
  // Data Mapping Tests
  // ============================================================================

  describe('Data Mapping', () => {
    test('should map input data using dot notation', async () => {
      const nestedParentDef = {
        ...parentDefinition,
        definition: {
          ...parentDefinition.definition,
          steps: [
            ...parentDefinition.definition!.steps.slice(0, 1),
            {
              stepId: 'invoke-child',
              stepName: 'Invoke Child Workflow',
              stepType: 'SUB_WORKFLOW',
              config: {
                subWorkflowId: 'child-workflow',
                inputMapping: {
                  'order.id': 'customer.order.id',
                  'order.total': 'customer.order.total',
                },
              },
            },
            ...parentDefinition.definition!.steps.slice(2),
          ],
        },
      }

      const nestedParentInstance = {
        ...parentInstance,
        context: {
          customer: {
            order: {
              id: '12345',
              total: 250.50,
            },
          },
        },
      }

      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: {},
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(nestedParentDef as WorkflowDefinition)

      await stepHandler.executeStep(
        mockEm,
        nestedParentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: nestedParentInstance.context,
        },
        mockContainer
      )

      const startCall = startWorkflowSpy.mock.calls[0]
      const initialContext = startCall[1].initialContext

      expect(initialContext).toEqual({
        order: {
          id: '12345',
          total: 250.50,
        },
      })

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })

    test('should map output data using dot notation', async () => {
      const nestedChildContext = {
        processing: {
          result: {
            status: 'APPROVED',
            code: 200,
          },
        },
      }

      const nestedParentDef = {
        ...parentDefinition,
        definition: {
          ...parentDefinition.definition,
          steps: [
            ...parentDefinition.definition!.steps.slice(0, 1),
            {
              stepId: 'invoke-child',
              stepName: 'Invoke Child Workflow',
              stepType: 'SUB_WORKFLOW',
              config: {
                subWorkflowId: 'child-workflow',
                inputMapping: {},
                outputMapping: {
                  'approval.status': 'processing.result.status',
                  'approval.code': 'processing.result.code',
                },
              },
            },
            ...parentDefinition.definition!.steps.slice(2),
          ],
        },
      }

      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: nestedChildContext,
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(nestedParentDef as WorkflowDefinition)

      const result = await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      expect(result.outputData).toEqual({
        approval: {
          status: 'APPROVED',
          code: 200,
        },
      })

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })

    test('should pass entire context when no input mapping provided', async () => {
      const noMappingDef = {
        ...parentDefinition,
        definition: {
          ...parentDefinition.definition,
          steps: [
            ...parentDefinition.definition!.steps.slice(0, 1),
            {
              stepId: 'invoke-child',
              stepName: 'Invoke Child Workflow',
              stepType: 'SUB_WORKFLOW',
              config: {
                subWorkflowId: 'child-workflow',
              },
            },
            ...parentDefinition.definition!.steps.slice(2),
          ],
        },
      }

      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: {},
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(noMappingDef as WorkflowDefinition)

      await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      const startCall = startWorkflowSpy.mock.calls[0]
      const initialContext = startCall[1].initialContext

      expect(initialContext).toEqual(parentInstance.context)

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })

    test('should return entire child context when no output mapping provided', async () => {
      const noMappingDef = {
        ...parentDefinition,
        definition: {
          ...parentDefinition.definition,
          steps: [
            ...parentDefinition.definition!.steps.slice(0, 1),
            {
              stepId: 'invoke-child',
              stepName: 'Invoke Child Workflow',
              stepType: 'SUB_WORKFLOW',
              config: {
                subWorkflowId: 'child-workflow',
              },
            },
            ...parentDefinition.definition!.steps.slice(2),
          ],
        },
      }

      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: childInstance.context!,
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(noMappingDef as WorkflowDefinition)

      const result = await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      expect(result.outputData).toEqual(childInstance.context)

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })
  })

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    test('should fail when sub-workflow ID is missing', async () => {
      const noSubWorkflowDef = {
        ...parentDefinition,
        definition: {
          ...parentDefinition.definition,
          steps: [
            ...parentDefinition.definition!.steps.slice(0, 1),
            {
              stepId: 'invoke-child',
              stepName: 'Invoke Child Workflow',
              stepType: 'SUB_WORKFLOW',
              config: {},
            },
            ...parentDefinition.definition!.steps.slice(2),
          ],
        },
      }

      mockEm.findOne.mockResolvedValue(noSubWorkflowDef as WorkflowDefinition)

      const result = await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      expect(result.status).toBe('FAILED')
      expect(result.error).toContain('Sub-workflow ID not specified')
    })

    test('should propagate child workflow failure to parent', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'FAILED',
        currentStep: 'process',
        context: {},
        events: [],
        errors: ['Processing failed: Invalid data'],
        executionTime: 50,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      const result = await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      expect(result.status).toBe('FAILED')
      expect(result.error).toContain('Sub-workflow failed')
      expect(result.error).toContain('Invalid data')

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })

    test('should handle invalid sub-workflow ID error', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')

      startWorkflowSpy.mockRejectedValue(new Error('Workflow definition not found: invalid-workflow'))

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      const result = await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      expect(result.status).toBe('FAILED')
      expect(result.error).toContain('Sub-workflow execution failed')

      startWorkflowSpy.mockRestore()
    })

    test('should fail when child workflow ends in unexpected state', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'PAUSED',
        currentStep: 'user-task',
        context: {},
        events: [],
        executionTime: 50,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      const result = await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      expect(result.status).toBe('FAILED')
      expect(result.error).toContain('Sub-workflow ended in unexpected state: PAUSED')

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })
  })

  // ============================================================================
  // Multi-Tenant Isolation Tests
  // ============================================================================

  describe('Multi-Tenant Isolation', () => {
    test('should inherit tenant ID from parent workflow', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: {},
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      const startCall = startWorkflowSpy.mock.calls[0]
      expect(startCall[1].tenantId).toBe(testTenantId)

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })

    test('should inherit organization ID from parent workflow', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: {},
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      const startCall = startWorkflowSpy.mock.calls[0]
      expect(startCall[1].organizationId).toBe(testOrgId)

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })

    test('should store parent-child relationship in metadata', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: {},
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      const startCall = startWorkflowSpy.mock.calls[0]
      const metadata = startCall[1].metadata

      expect(metadata?.labels?.parentInstanceId).toBe(parentInstanceId)
      expect(metadata?.labels?.parentStepId).toBe('invoke-child')

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })
  })

  // ============================================================================
  // Event Logging Tests
  // ============================================================================

  describe('Event Logging', () => {
    test('should log SUB_WORKFLOW_STARTED event', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: childInstance.context!,
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      const createCalls = mockEm.create.mock.calls
      const eventCalls = createCalls.filter((call: any) => call[0].name === 'WorkflowEvent')

      const startedEvent = eventCalls.find((call: any) => call[1].eventType === 'SUB_WORKFLOW_STARTED')
      expect(startedEvent).toBeDefined()
      expect(startedEvent![1].eventData.subWorkflowId).toBe('child-workflow')
      expect(startedEvent![1].eventData.childInstanceId).toBe(childInstanceId)

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })

    test('should log SUB_WORKFLOW_COMPLETED event with output data', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: childInstance.context!,
        events: [],
        executionTime: 100,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      const createCalls = mockEm.create.mock.calls
      const eventCalls = createCalls.filter((call: any) => call[0].name === 'WorkflowEvent')

      const completedEvent = eventCalls.find((call: any) => call[1].eventType === 'SUB_WORKFLOW_COMPLETED')
      expect(completedEvent).toBeDefined()
      expect(completedEvent![1].eventData.childInstanceId).toBe(childInstanceId)
      expect(completedEvent![1].eventData.outputData).toBeDefined()

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })

    test('should log SUB_WORKFLOW_FAILED event on error', async () => {
      const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')

      startWorkflowSpy.mockResolvedValue(childInstance as WorkflowInstance)
      executeWorkflowSpy.mockResolvedValue({
        status: 'FAILED',
        currentStep: 'process',
        context: {},
        events: [],
        errors: ['Processing error'],
        executionTime: 50,
      })

      mockEm.findOne.mockResolvedValue(parentDefinition as WorkflowDefinition)

      await stepHandler.executeStep(
        mockEm,
        parentInstance as WorkflowInstance,
        'invoke-child',
        {
          workflowContext: parentInstance.context!,
        },
        mockContainer
      )

      const createCalls = mockEm.create.mock.calls
      const eventCalls = createCalls.filter((call: any) => call[0].name === 'WorkflowEvent')

      const failedEvent = eventCalls.find((call: any) => call[1].eventType === 'SUB_WORKFLOW_FAILED')
      expect(failedEvent).toBeDefined()
      expect(failedEvent![1].eventData.childInstanceId).toBe(childInstanceId)
      expect(failedEvent![1].eventData.error).toContain('Processing error')

      startWorkflowSpy.mockRestore()
      executeWorkflowSpy.mockRestore()
    })
  })
})
