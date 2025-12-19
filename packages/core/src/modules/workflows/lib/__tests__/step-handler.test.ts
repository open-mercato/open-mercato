import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import * as stepHandler from '../step-handler'
import type {
  WorkflowDefinition,
  WorkflowInstance,
  StepInstance,
  UserTask,
} from '../../data/entities'

describe('Step Handler (Unit Tests)', () => {
  let mockEm: jest.Mocked<EntityManager>

  const testTenantId = '00000000-0000-4000-8000-000000000001'
  const testOrgId = '00000000-0000-4000-8000-000000000002'
  const testDefinitionId = '00000000-0000-4000-8000-000000000003'
  const testInstanceId = '00000000-0000-4000-8000-000000000004'

  // Mock workflow definition with multiple step types
  const mockDefinition: Partial<WorkflowDefinition> = {
    id: testDefinitionId,
    workflowId: 'test-workflow',
    workflowName: 'Test Workflow',
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
          stepId: 'automated-step',
          stepName: 'Automated Step',
          stepType: 'AUTOMATED',
          description: 'An automated step',
        },
        {
          stepId: 'user-task-step',
          stepName: 'User Task Step',
          stepType: 'USER_TASK',
          description: 'A user task',
          userTaskConfig: {
            formSchema: {
              fields: [
                { name: 'approved', type: 'boolean', label: 'Approved', required: true },
              ],
            },
            assignedTo: 'manager@example.com',
            slaDuration: 'P1D',
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

  const mockInstance: Partial<WorkflowInstance> = {
    id: testInstanceId,
    definitionId: testDefinitionId,
    workflowId: 'test-workflow',
    version: 1,
    status: 'RUNNING',
    currentStepId: 'start',
    context: { orderId: '12345' },
    tenantId: testTenantId,
    organizationId: testOrgId,
    startedAt: new Date(),
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

    // Reset all mocks
    jest.clearAllMocks()
  })

  // ============================================================================
  // enterStep() Tests
  // ============================================================================

  describe('enterStep', () => {
    test('should create step instance when entering a step', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition as WorkflowDefinition)

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'automated-step',
        stepName: 'Automated Step',
        stepType: 'AUTOMATED',
        status: 'ACTIVE',
        enteredAt: expect.any(Date),
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      mockEm.create.mockReturnValue(mockStepInstance)

      const stepInstance = await stepHandler.enterStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'automated-step',
        { workflowContext: { orderId: '12345' } }
      )

      expect(stepInstance).toBeDefined()
      expect(stepInstance.stepId).toBe('automated-step')
      expect(stepInstance.stepName).toBe('Automated Step')
      expect(stepInstance.stepType).toBe('AUTOMATED')
      expect(stepInstance.status).toBe('ACTIVE')
      expect(mockEm.create).toHaveBeenCalled()
      expect(mockEm.persistAndFlush).toHaveBeenCalledWith(mockStepInstance)
    })

    test('should throw error if definition not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      await expect(
        stepHandler.enterStep(
          mockEm,
          mockInstance as WorkflowInstance,
          'automated-step',
          { workflowContext: {} }
        )
      ).rejects.toThrow('Workflow definition not found')
    })

    test('should throw error if step not found in definition', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition as WorkflowDefinition)

      await expect(
        stepHandler.enterStep(
          mockEm,
          mockInstance as WorkflowInstance,
          'non-existent-step',
          { workflowContext: {} }
        )
      ).rejects.toThrow('Step not found in workflow definition')
    })

    test('should support trigger data as input', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition as WorkflowDefinition)

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'automated-step',
        stepName: 'Automated Step',
        stepType: 'AUTOMATED',
        status: 'ACTIVE',
        inputData: { trigger: 'manual', userId: 'user-123' },
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      mockEm.create.mockReturnValue(mockStepInstance)

      const stepInstance = await stepHandler.enterStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'automated-step',
        {
          workflowContext: {},
          triggerData: { trigger: 'manual', userId: 'user-123' },
        }
      )

      expect(stepInstance.inputData).toEqual({ trigger: 'manual', userId: 'user-123' })
    })
  })

  // ============================================================================
  // exitStep() Tests
  // ============================================================================

  describe('exitStep', () => {
    test('should mark step as completed and record timing', async () => {
      const enteredAt = new Date(Date.now() - 5000) // 5 seconds ago
      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'automated-step',
        stepName: 'Automated Step',
        stepType: 'AUTOMATED',
        status: 'ACTIVE',
        enteredAt,
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      await stepHandler.exitStep(mockEm, mockStepInstance, { result: 'success' })

      expect(mockStepInstance.status).toBe('COMPLETED')
      expect(mockStepInstance.outputData).toEqual({ result: 'success' })
      expect(mockStepInstance.exitedAt).toBeDefined()
      expect(mockStepInstance.executionTimeMs).toBeGreaterThan(4000)
      expect(mockStepInstance.executionTimeMs).toBeLessThan(6000)
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('should handle exit without output data', async () => {
      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'automated-step',
        status: 'ACTIVE',
        enteredAt: new Date(),
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      await stepHandler.exitStep(mockEm, mockStepInstance)

      expect(mockStepInstance.status).toBe('COMPLETED')
      expect(mockStepInstance.outputData).toBeNull()
      expect(mockStepInstance.exitedAt).toBeDefined()
    })
  })

  // ============================================================================
  // executeStep() Tests - START step
  // ============================================================================

  describe('executeStep - START step', () => {
    test('should execute START step and complete immediately', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition as WorkflowDefinition)

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'start',
        stepName: 'Start',
        stepType: 'START',
        status: 'ACTIVE',
        enteredAt: new Date(),
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      mockEm.create.mockReturnValue(mockStepInstance)

      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'start',
        { workflowContext: {} }
      )

      expect(result.status).toBe('COMPLETED')
      expect(result.outputData).toBeDefined()
      expect(result.outputData.stepType).toBe('START')
      expect(mockEm.flush).toHaveBeenCalled() // exitStep was called
    })
  })

  // ============================================================================
  // executeStep() Tests - END step
  // ============================================================================

  describe('executeStep - END step', () => {
    test('should execute END step and complete with final context', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition as WorkflowDefinition)

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'end',
        stepName: 'End',
        stepType: 'END',
        status: 'ACTIVE',
        enteredAt: new Date(),
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      mockEm.create.mockReturnValue(mockStepInstance)

      const workflowContext = { orderId: '12345', approved: true }
      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'end',
        { workflowContext }
      )

      expect(result.status).toBe('COMPLETED')
      expect(result.outputData).toBeDefined()
      expect(result.outputData.stepType).toBe('END')
      expect(result.outputData.finalContext).toEqual(workflowContext)
    })
  })

  // ============================================================================
  // executeStep() Tests - AUTOMATED step
  // ============================================================================

  describe('executeStep - AUTOMATED step', () => {
    test('should execute AUTOMATED step and complete (MVP)', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition as WorkflowDefinition)

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'automated-step',
        stepName: 'Automated Step',
        stepType: 'AUTOMATED',
        status: 'ACTIVE',
        enteredAt: new Date(),
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      mockEm.create.mockReturnValue(mockStepInstance)

      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'automated-step',
        { workflowContext: { orderId: '12345' } }
      )

      expect(result.status).toBe('COMPLETED')
      expect(result.outputData).toBeDefined()
      expect(result.outputData.stepType).toBe('AUTOMATED')
    })
  })

  // ============================================================================
  // executeStep() Tests - USER_TASK step
  // ============================================================================

  describe('executeStep - USER_TASK step', () => {
    test('should execute USER_TASK step and enter waiting state', async () => {
      // Need two calls to findOne - one in enterStep, one in executeStep
      mockEm.findOne
        .mockResolvedValueOnce(mockDefinition as WorkflowDefinition) // enterStep
        .mockResolvedValueOnce(mockDefinition as WorkflowDefinition) // executeStep

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'user-task-step',
        stepName: 'User Task Step',
        stepType: 'USER_TASK',
        status: 'ACTIVE',
        enteredAt: new Date(),
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      const mockUserTask = {
        id: 'user-task-1',
        workflowInstanceId: testInstanceId,
        stepInstanceId: 'step-instance-1',
        taskName: 'User Task Step',
        status: 'PENDING',
        assignedTo: 'manager@example.com',
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as UserTask

      mockEm.create
        .mockReturnValueOnce(mockStepInstance) // First call: create step instance
        .mockReturnValueOnce({} as any) // Second call: create event (enterStep)
        .mockReturnValueOnce(mockUserTask) // Third call: create user task
        .mockReturnValueOnce({} as any) // Fourth call: create event (USER_TASK_CREATED)

      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'user-task-step',
        { workflowContext: {} }
      )

      expect(result.status).toBe('WAITING')
      expect(result.waitReason).toBe('USER_TASK')
      expect(result.outputData).toBeDefined()
      expect(result.outputData.userTaskId).toBe('user-task-1')
    })

    test('should create user task with form schema and assignment', async () => {
      mockEm.findOne
        .mockResolvedValueOnce(mockDefinition as WorkflowDefinition)
        .mockResolvedValueOnce(mockDefinition as WorkflowDefinition)

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'user-task-step',
        stepName: 'User Task Step',
        stepType: 'USER_TASK',
        status: 'ACTIVE',
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      const mockUserTask = {
        id: 'user-task-1',
        workflowInstanceId: testInstanceId,
        stepInstanceId: 'step-instance-1',
        taskName: 'User Task Step',
        status: 'PENDING',
        formSchema: {
          fields: [
            { name: 'approved', type: 'boolean', label: 'Approved', required: true },
          ],
        },
        assignedTo: 'manager@example.com',
        dueDate: expect.any(Date),
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as UserTask

      mockEm.create
        .mockReturnValueOnce(mockStepInstance)
        .mockReturnValueOnce({} as any) // event
        .mockReturnValueOnce(mockUserTask)
        .mockReturnValueOnce({} as any) // event

      await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'user-task-step',
        { workflowContext: {} }
      )

      // Verify user task was created with correct properties
      // Calls: step instance, event, user task, event
      expect(mockEm.create).toHaveBeenCalledTimes(4)
      const userTaskCall = (mockEm.create as jest.Mock).mock.calls[2] // Third call is user task
      expect(userTaskCall[1].formSchema).toBeDefined()
      expect(userTaskCall[1].assignedTo).toBe('manager@example.com')
      expect(userTaskCall[1].dueDate).toBeDefined()
    })

    test('should support role-based assignment', async () => {
      const definitionWithRoleAssignment = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          steps: [
            {
              stepId: 'user-task-roles',
              stepName: 'Role Task',
              stepType: 'USER_TASK',
              userTaskConfig: {
                assignedTo: ['manager', 'admin'],
              },
            },
          ],
        },
      }

      mockEm.findOne
        .mockResolvedValueOnce(definitionWithRoleAssignment as WorkflowDefinition)
        .mockResolvedValueOnce(definitionWithRoleAssignment as WorkflowDefinition)

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'user-task-roles',
        stepName: 'Role Task',
        stepType: 'USER_TASK',
        status: 'ACTIVE',
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      const mockUserTask = {
        id: 'user-task-1',
        assignedTo: null,
        assignedToRoles: ['manager', 'admin'],
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as UserTask

      mockEm.create
        .mockReturnValueOnce(mockStepInstance)
        .mockReturnValueOnce({} as any) // event
        .mockReturnValueOnce(mockUserTask)
        .mockReturnValueOnce({} as any) // event

      await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'user-task-roles',
        { workflowContext: {} }
      )

      const userTaskCall = (mockEm.create as jest.Mock).mock.calls[2] // Third call is user task
      expect(userTaskCall[1].assignedTo).toBeNull()
      expect(userTaskCall[1].assignedToRoles).toEqual(['manager', 'admin'])
    })
  })

  // ============================================================================
  // executeStep() Tests - Error Handling
  // ============================================================================

  describe('executeStep - Error Handling', () => {
    test('should handle step execution errors gracefully', async () => {
      mockEm.findOne
        .mockResolvedValueOnce(mockDefinition as WorkflowDefinition)
        .mockResolvedValueOnce(null) // Simulate error finding definition on second call

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'automated-step',
        stepName: 'Automated Step',
        stepType: 'AUTOMATED',
        status: 'ACTIVE',
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      mockEm.create.mockReturnValue(mockStepInstance)
      mockEm.findOne.mockResolvedValueOnce(mockStepInstance) // For error recovery

      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'automated-step',
        { workflowContext: {} }
      )

      expect(result.status).toBe('FAILED')
      expect(result.error).toBeDefined()
    })

    test('should mark step as FAILED on error', async () => {
      mockEm.findOne
        .mockResolvedValueOnce(mockDefinition as WorkflowDefinition)
        .mockResolvedValueOnce(null) // Simulate error

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'automated-step',
        status: 'ACTIVE',
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      mockEm.create.mockReturnValue(mockStepInstance)
      mockEm.findOne.mockResolvedValueOnce(mockStepInstance) // For error recovery

      await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'automated-step',
        { workflowContext: {} }
      )

      expect(mockStepInstance.status).toBe('FAILED')
      expect(mockStepInstance.errorData).toBeDefined()
      expect(mockStepInstance.exitedAt).toBeDefined()
    })

    test('should throw error for unimplemented step types', async () => {
      const definitionWithUnsupportedStep = {
        ...mockDefinition,
        definition: {
          steps: [
            {
              stepId: 'parallel-fork',
              stepName: 'Parallel Fork',
              stepType: 'PARALLEL_FORK',
            },
          ],
          transitions: [],
        },
      }

      mockEm.findOne
        .mockResolvedValueOnce(definitionWithUnsupportedStep as WorkflowDefinition) // enterStep
        .mockResolvedValueOnce(definitionWithUnsupportedStep as WorkflowDefinition) // executeStep

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'parallel-fork',
        stepName: 'Parallel Fork',
        stepType: 'PARALLEL_FORK',
        status: 'ACTIVE',
        tenantId: testTenantId,
        organizationId: testOrgId,
      } as StepInstance

      mockEm.create
        .mockReturnValueOnce(mockStepInstance)
        .mockReturnValueOnce({} as any) // event

      // Mock for error recovery - findOne to get the failed step
      mockEm.findOne.mockResolvedValueOnce(mockStepInstance)

      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'parallel-fork',
        { workflowContext: {} }
      )

      expect(result.status).toBe('FAILED')
      expect(result.error).toContain('not yet implemented')
    })
  })
})
