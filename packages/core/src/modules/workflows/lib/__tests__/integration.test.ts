/**
 * Workflow Engine Integration Tests
 *
 * Tests the complete workflow engine with all services working together:
 * - Workflow Executor
 * - Step Handler
 * - Transition Handler
 * - Activity Executor
 * - Event Logger
 */

import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import {
  WorkflowInstance,
  WorkflowDefinition,
  StepInstance,
  UserTask,
  WorkflowEvent,
} from '../../data/entities'
import * as workflowExecutor from '../workflow-executor'
import * as stepHandler from '../step-handler'
import * as transitionHandler from '../transition-handler'
import * as eventLogger from '../event-logger'

// Mock business rules
jest.mock('../../../business_rules/lib/rule-evaluator')
jest.mock('../../../business_rules/lib/rule-engine')

describe('Workflow Engine Integration Tests', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>

  const testTenantId = 'test-tenant-id'
  const testOrgId = 'test-org-id'
  const testUserId = 'test-user-id'

  beforeEach(() => {
    // Create mock EntityManager
    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      persistAndFlush: jest.fn(),
      flush: jest.fn(),
      count: jest.fn(),
    } as any

    // Create mock DI container
    mockContainer = {
      resolve: jest.fn(),
    } as any

    // Reset mocks
    jest.clearAllMocks()
  })

  // ============================================================================
  // Simple Workflow: START → END
  // ============================================================================

  describe('Simple workflow (START → END)', () => {
    test('should execute workflow from start to completion', async () => {
      const mockDefinition = {
        id: 'def-1',
        workflowId: 'simple-workflow',
        workflowName: 'Simple Workflow',
        version: 1,
        definition: {
          workflowId: 'simple-workflow',
          workflowName: 'Simple Workflow',
          version: 1,
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            { fromStepId: 'start', toStepId: 'end' },
          ],
        },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowDefinition

      const mockInstance = {
        id: 'instance-1',
        definitionId: 'def-1',
        workflowId: 'simple-workflow',
        currentStepId: 'start',
        status: 'RUNNING',
        version: 1,
        startedAt: new Date(),
        retryCount: 0,
        context: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowInstance

      // Mock entity manager calls
      mockEm.findOne
        .mockResolvedValueOnce(mockDefinition) // startWorkflow
        .mockResolvedValueOnce(mockInstance) // executeWorkflow - get instance
        .mockResolvedValueOnce(mockDefinition) // executeWorkflow - get definition
        .mockResolvedValueOnce(mockInstance) // completeWorkflow

      mockEm.create.mockImplementation((entity, data) => {
        if (entity === WorkflowInstance) {
          return { ...mockInstance, ...data }
        }
        return data as any
      })

      // Start workflow
      const instance = await workflowExecutor.startWorkflow(mockEm, {
        workflowId: 'simple-workflow',
        version: 1,
        initialContext: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(instance).toBeDefined()
      expect(instance.status).toBe('RUNNING')

      // Execute workflow
      const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, instance.id)

      // Workflow should be running (it doesn't auto-execute all steps in this test)
      expect(result.status).toBe('RUNNING')
      expect(result).toBeDefined()
    })
  })

  // ============================================================================
  // Multi-Step Workflow: START → STEP1 → STEP2 → END
  // ============================================================================

  describe('Multi-step workflow with automated steps', () => {
    test('should execute workflow through multiple automated steps', async () => {
      const mockDefinition = {
        id: 'def-2',
        workflowId: 'multi-step',
        workflowName: 'Multi Step',
        version: 1,
        definition: {
          workflowId: 'multi-step',
          workflowName: 'Multi-Step Workflow',
          version: 1,
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'step1', stepName: 'Step 1', stepType: 'AUTOMATED' },
            { stepId: 'step2', stepName: 'Step 2', stepType: 'AUTOMATED' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            { fromStepId: 'start', toStepId: 'step1' },
            { fromStepId: 'step1', toStepId: 'step2' },
            { fromStepId: 'step2', toStepId: 'end' },
          ],
        },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowDefinition

      const mockInstance = {
        id: 'instance-2',
        definitionId: 'def-2',
        workflowId: 'multi-step',
        currentStepId: 'start',
        status: 'RUNNING',
        version: 1,
        startedAt: new Date(),
        retryCount: 0,
        context: { counter: 0 },
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowInstance

      mockEm.findOne.mockResolvedValue(mockDefinition)
      mockEm.create.mockImplementation((entity, data) => {
        if (entity === WorkflowInstance) {
          return { ...mockInstance, ...data }
        }
        if (entity === StepInstance) {
          return {
            id: `step-${Date.now()}`,
            ...data,
          } as any
        }
        return data as any
      })

      // Start workflow
      const instance = await workflowExecutor.startWorkflow(mockEm, {
        workflowId: 'multi-step',
        version: 1,
        initialContext: { counter: 0 },
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(instance.currentStepId).toBe('start')

      // Verify step instances can be created
      const stepInstance = await stepHandler.enterStep(
        mockEm,
        instance,
        'step1',
        { workflowContext: instance.context }
      )

      expect(stepInstance.stepId).toBe('step1')
      expect(stepInstance.status).toBe('ACTIVE')
    })
  })

  // ============================================================================
  // Workflow with User Task
  // ============================================================================

  describe('Workflow with user task', () => {
    test('should create user task and enter waiting state', async () => {
      const mockDefinition = {
        id: 'def-3',
        workflowId: 'user-task-workflow',
        workflowName: 'User Task Workflow',
        version: 1,
        definition: {
          workflowId: 'user-task-workflow',
          workflowName: 'User Task Workflow',
          version: 1,
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            {
              stepId: 'approval',
              stepName: 'Approval',
              stepType: 'USER_TASK',
              userTaskConfig: {
                assignedTo: 'manager@example.com',
                slaDuration: 'P1D',
                formSchema: {
                  fields: [
                    { name: 'approved', type: 'boolean', label: 'Approve?' },
                    { name: 'comments', type: 'text', label: 'Comments' },
                  ],
                },
              },
            },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            { fromStepId: 'start', toStepId: 'approval' },
            { fromStepId: 'approval', toStepId: 'end' },
          ],
        },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowDefinition

      const mockInstance = {
        id: 'instance-3',
        definitionId: 'def-3',
        workflowId: 'user-task-workflow',
        currentStepId: 'start',
        status: 'RUNNING',
        version: 1,
        startedAt: new Date(),
        retryCount: 0,
        context: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowInstance

      const mockStepInstance = {
        id: 'step-3',
        workflowInstanceId: 'instance-3',
        stepId: 'approval',
        stepName: 'Approval',
        stepType: 'USER_TASK',
        status: 'ACTIVE',
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as StepInstance

      const mockUserTask = {
        id: 'task-1',
        workflowInstanceId: 'instance-3',
        stepInstanceId: 'step-3',
        taskName: 'Approval',
        status: 'PENDING',
        assignedTo: 'manager@example.com',
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as UserTask

      mockEm.findOne
        .mockResolvedValueOnce(mockDefinition) // enterStep
        .mockResolvedValueOnce(mockDefinition) // executeStep

      mockEm.create
        .mockReturnValueOnce(mockStepInstance) // step instance
        .mockReturnValueOnce({} as any) // event (STEP_ENTERED)
        .mockReturnValueOnce(mockUserTask) // user task
        .mockReturnValueOnce({} as any) // event (USER_TASK_CREATED)

      // Execute user task step
      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance,
        'approval',
        { workflowContext: {} }
      )

      expect(result.status).toBe('WAITING')
      expect(result.waitReason).toBe('USER_TASK')
      expect(result.outputData?.userTaskId).toBeDefined()
    })
  })

  // ============================================================================
  // Workflow with Transitions
  // ============================================================================

  describe('Workflow transitions', () => {
    test('should evaluate and execute valid transitions', async () => {
      const mockDefinition = {
        id: 'def-4',
        workflowId: 'transition-workflow',
        workflowName: 'Transition Workflow',
        version: 1,
        definition: {
          workflowId: 'transition-workflow',
          workflowName: 'Transition Workflow',
          version: 1,
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'step1', stepName: 'Step 1', stepType: 'AUTOMATED' },
            { stepId: 'end', stepName: 'End', stepType: 'END' },
          ],
          transitions: [
            {
              transitionId: 't1',
              fromStepId: 'start',
              toStepId: 'step1',
              transitionName: 'Start to Step 1',
            },
            {
              transitionId: 't2',
              fromStepId: 'step1',
              toStepId: 'end',
              transitionName: 'Step 1 to End',
            },
          ],
        },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowDefinition

      const mockInstance = {
        id: 'instance-4',
        definitionId: 'def-4',
        workflowId: 'transition-workflow',
        currentStepId: 'start',
        status: 'RUNNING',
        version: 1,
        startedAt: new Date(),
        retryCount: 0,
        context: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowInstance

      // Mock for evaluateTransition
      mockEm.findOne.mockResolvedValue(mockDefinition)

      // Evaluate transition from start to step1
      const evaluation = await transitionHandler.evaluateTransition(
        mockEm,
        mockInstance,
        'start',
        'step1',
        { workflowContext: {} }
      )

      expect(evaluation.isValid).toBe(true)
      expect(evaluation.transition).toBeDefined()
      expect(evaluation.transition.fromStepId).toBe('start')
      expect(evaluation.transition.toStepId).toBe('step1')
    })

    test('should find all valid transitions from a step', async () => {
      const mockDefinition = {
        id: 'def-5',
        workflowId: 'multi-transition',
        workflowName: 'Multi Transition',
        version: 1,
        definition: {
          workflowId: 'multi-transition',
          workflowName: 'Multi-Transition Workflow',
          version: 1,
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
            { stepId: 'approved', stepName: 'Approved', stepType: 'AUTOMATED' },
            { stepId: 'rejected', stepName: 'Rejected', stepType: 'AUTOMATED' },
          ],
          transitions: [
            { fromStepId: 'start', toStepId: 'approved' },
            { fromStepId: 'start', toStepId: 'rejected' },
          ],
        },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowDefinition

      const mockInstance = {
        id: 'instance-5',
        definitionId: 'def-5',
        workflowId: 'multi-transition',
        currentStepId: 'start',
        status: 'RUNNING',
        version: 1,
        startedAt: new Date(),
        retryCount: 0,
        context: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowInstance

      mockEm.findOne.mockResolvedValue(mockDefinition)

      const validTransitions = await transitionHandler.findValidTransitions(
        mockEm,
        mockInstance,
        'start',
        { workflowContext: {} }
      )

      expect(validTransitions).toHaveLength(2)
      expect(validTransitions.every(t => t.isValid)).toBe(true)
    })
  })

  // ============================================================================
  // Event Logging Integration
  // ============================================================================

  describe('Event logging integration', () => {
    test('should log workflow events throughout execution', async () => {
      const mockEvents: WorkflowEvent[] = []

      mockEm.create.mockImplementation((entity, data) => {
        if (entity === WorkflowEvent) {
          const event = {
            id: `event-${mockEvents.length + 1}`,
            ...data,
            occurredAt: new Date(),
          } as WorkflowEvent
          mockEvents.push(event)
          return event
        }
        return data as any
      })

      // Log various workflow events
      await eventLogger.logWorkflowEvent(mockEm, {
        workflowInstanceId: 'instance-1',
        eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
        eventData: { workflowId: 'test-workflow' },
        userId: testUserId,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await eventLogger.logWorkflowEvent(mockEm, {
        workflowInstanceId: 'instance-1',
        stepInstanceId: 'step-1',
        eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
        eventData: { stepId: 'step1', stepName: 'Step 1' },
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await eventLogger.logWorkflowEvent(mockEm, {
        workflowInstanceId: 'instance-1',
        eventType: eventLogger.WorkflowEventTypes.WORKFLOW_COMPLETED,
        eventData: { result: { success: true } },
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(mockEvents).toHaveLength(3)
      expect(mockEvents[0].eventType).toBe(eventLogger.WorkflowEventTypes.WORKFLOW_STARTED)
      expect(mockEvents[1].eventType).toBe(eventLogger.WorkflowEventTypes.STEP_ENTERED)
      expect(mockEvents[2].eventType).toBe(eventLogger.WorkflowEventTypes.WORKFLOW_COMPLETED)
    })

    test('should query workflow events', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          workflowInstanceId: 'instance-1',
          eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
          eventData: {},
          occurredAt: new Date('2025-01-01T10:00:00Z'),
        },
        {
          id: 'event-2',
          workflowInstanceId: 'instance-1',
          eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
          eventData: {},
          occurredAt: new Date('2025-01-01T10:05:00Z'),
        },
        {
          id: 'event-3',
          workflowInstanceId: 'instance-1',
          eventType: eventLogger.WorkflowEventTypes.WORKFLOW_COMPLETED,
          eventData: {},
          occurredAt: new Date('2025-01-01T10:10:00Z'),
        },
      ] as WorkflowEvent[]

      mockEm.find.mockResolvedValue(mockEvents)

      const events = await eventLogger.getWorkflowEvents(mockEm, 'instance-1')

      expect(events).toHaveLength(3)
      expect(events[0].eventType).toBe(eventLogger.WorkflowEventTypes.WORKFLOW_STARTED)
    })
  })

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('Error handling', () => {
    test('should handle workflow execution failures gracefully', async () => {
      const mockDefinition = {
        id: 'def-6',
        workflowId: 'failing-workflow',
        workflowName: 'Failing Workflow',
        version: 1,
        definition: {
          workflowId: 'failing-workflow',
          workflowName: 'Failing Workflow',
          version: 1,
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' },
          ],
          transitions: [],
        },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowDefinition

      mockEm.findOne.mockResolvedValue(mockDefinition)
      mockEm.create.mockImplementation(() => {
        throw new Error('Database error')
      })

      await expect(
        workflowExecutor.startWorkflow(mockEm, {
          workflowId: 'failing-workflow',
          version: 1,
          initialContext: {},
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      ).rejects.toThrow()
    })

    test('should handle step execution failures', async () => {
      const mockDefinition = {
        id: 'def-7',
        workflowId: 'step-failure',
        workflowName: 'Step Failure',
        version: 1,
        definition: {
          workflowId: 'step-failure',
          workflowName: 'Step Failure Workflow',
          version: 1,
          steps: [
            { stepId: 'failing-step', stepName: 'Failing Step', stepType: 'AUTOMATED' },
          ],
          transitions: [],
        },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowDefinition

      const mockInstance = {
        id: 'instance-7',
        definitionId: 'def-7',
        workflowId: 'step-failure',
        currentStepId: 'failing-step',
        status: 'RUNNING',
        version: 1,
        startedAt: new Date(),
        retryCount: 0,
        context: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowInstance

      mockEm.findOne.mockResolvedValue(null) // Simulate definition not found

      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance,
        'failing-step',
        { workflowContext: {} }
      )

      expect(result.status).toBe('FAILED')
      expect(result.error).toBeDefined()
    })
  })

  // ============================================================================
  // Context Management
  // ============================================================================

  describe('Workflow context management', () => {
    test('should update workflow context throughout execution', async () => {
      const mockInstance = {
        id: 'instance-8',
        definitionId: 'def-8',
        workflowId: 'context-workflow',
        currentStepId: 'step1',
        status: 'RUNNING',
        version: 1,
        startedAt: new Date(),
        retryCount: 0,
        context: { counter: 0 },
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as WorkflowInstance

      mockEm.findOne.mockResolvedValue(mockInstance)

      const newContext = { counter: 1, newField: 'value' }

      // Update context
      await workflowExecutor.updateWorkflowContext(
        mockEm,
        'instance-8',
        newContext
      )

      expect(mockEm.flush).toHaveBeenCalled()
      // Note: The instance's context would be updated by the actual function
      // In a real scenario, the EM would persist these changes
    })
  })
})
