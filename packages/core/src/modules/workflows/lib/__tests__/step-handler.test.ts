import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import * as stepHandler from '../step-handler'
import { WorkflowEvent } from '../../data/entities'
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
      persist: jest.fn(function persist(this: any) { return this }),
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as StepInstance

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
      expect(mockEm.persist).toHaveBeenCalledWith(mockStepInstance)
      expect(mockEm.flush).toHaveBeenCalled()
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
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
  // executeStep() Tests - IF_ELSE / SWITCH branching steps (transition sugar)
  // ============================================================================

  describe('executeStep - branching steps', () => {
    const branchingDefinition: Partial<WorkflowDefinition> = {
      ...mockDefinition,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'if-else-step', stepName: 'Amount Check', stepType: 'IF_ELSE' },
          { stepId: 'switch-step', stepName: 'Channel Switch', stepType: 'SWITCH' },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          {
            transitionId: 'e_if-else-step_end',
            fromStepId: 'if-else-step',
            toStepId: 'end',
            trigger: 'auto',
            priority: 10,
            condition: { field: 'total', operator: '>', value: 100 },
          },
        ],
      },
    }

    function stepInstanceFor(stepId: string, stepType: string): StepInstance {
      return {
        id: `step-instance-${stepId}`,
        workflowInstanceId: testInstanceId,
        stepId,
        stepName: stepId,
        stepType,
        status: 'ACTIVE',
        enteredAt: new Date(),
        tenantId: testTenantId,
        organizationId: testOrgId,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as StepInstance
    }

    test('should complete an IF_ELSE step immediately without executing anything', async () => {
      mockEm.findOne.mockResolvedValue(branchingDefinition as WorkflowDefinition)
      mockEm.create.mockReturnValue(stepInstanceFor('if-else-step', 'IF_ELSE'))

      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'if-else-step',
        { workflowContext: { total: 250 } }
      )

      expect(result.status).toBe('COMPLETED')
      expect(result.outputData.stepType).toBe('IF_ELSE')
      expect(result.nextSteps).toBeUndefined()
      expect(result.waitReason).toBeUndefined()
    })

    test('should complete a SWITCH step immediately without executing anything', async () => {
      mockEm.findOne.mockResolvedValue(branchingDefinition as WorkflowDefinition)
      mockEm.create.mockReturnValue(stepInstanceFor('switch-step', 'SWITCH'))

      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'switch-step',
        { workflowContext: { channel: 'web' } }
      )

      expect(result.status).toBe('COMPLETED')
      expect(result.outputData.stepType).toBe('SWITCH')
      expect(result.nextSteps).toBeUndefined()
      expect(result.waitReason).toBeUndefined()
    })

    test('should leave routing to the transition evaluator, not the step handler', async () => {
      mockEm.findOne.mockResolvedValue(branchingDefinition as WorkflowDefinition)
      mockEm.create.mockReturnValue(stepInstanceFor('if-else-step', 'IF_ELSE'))

      const matched = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'if-else-step',
        { workflowContext: { total: 250 } }
      )

      jest.clearAllMocks()
      mockEm.findOne.mockResolvedValue(branchingDefinition as WorkflowDefinition)
      mockEm.create.mockReturnValue(stepInstanceFor('if-else-step', 'IF_ELSE'))

      const unmatched = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'if-else-step',
        { workflowContext: { total: 1 } }
      )

      expect(unmatched.status).toBe(matched.status)
      expect(unmatched.outputData.stepType).toBe(matched.outputData.stepType)
    })

    test('should keep the executed trace of a legacy definition unchanged', async () => {
      const trace: Array<Record<string, unknown>> = []
      mockEm.create.mockImplementation(((entity: unknown, payload: Record<string, unknown>) => {
        if (entity === WorkflowEvent) {
          trace.push({
            eventType: payload.eventType,
            stepInstanceId: payload.stepInstanceId,
            eventData: payload.eventData,
          })
          return payload as unknown as WorkflowEvent
        }
        return payload as unknown as StepInstance
      }) as never)
      mockEm.findOne.mockResolvedValue(mockDefinition as WorkflowDefinition)

      for (const stepId of ['start', 'automated-step', 'end']) {
        await stepHandler.executeStep(
          mockEm,
          mockInstance as WorkflowInstance,
          stepId,
          { workflowContext: { orderId: '12345' } }
        )
      }

      expect(
        trace.map((entry) => {
          const eventData = entry.eventData as {
            stepId?: string
            stepType?: string
            status?: string
            hasOutput?: boolean
          }
          return [entry.eventType, eventData.stepId, eventData.stepType ?? eventData.status, eventData.hasOutput]
        }),
      ).toEqual([
        ['STEP_ENTERED', 'start', 'START', undefined],
        ['STEP_EXITED', 'start', 'COMPLETED', true],
        ['STEP_ENTERED', 'automated-step', 'AUTOMATED', undefined],
        ['STEP_EXITED', 'automated-step', 'COMPLETED', true],
        ['STEP_ENTERED', 'end', 'END', undefined],
        ['STEP_EXITED', 'end', 'COMPLETED', true],
      ])
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
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
        createdAt: new Date(),
        updatedAt: new Date(),
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

    // Dry-run isolation (spec section 8.2): the USER_TASK step is the one place
    // a run creates a task row, so it is the one place the suppression has to
    // hold. No row means no `workflows.task.assigned` event, therefore no
    // notification row, no SLA queue jobs, and nothing for any Work Inbox or
    // task-list query to return.
    test('a dry run raises NO UserTask row, and still waits so the author can simulate the decision', async () => {
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
        enteredAt: new Date(),
        tenantId: testTenantId,
        organizationId: testOrgId,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as StepInstance

      const createdEntities: unknown[] = []
      mockEm.create.mockImplementation(((entity: unknown, payload: Record<string, unknown>) => {
        createdEntities.push(entity)
        return createdEntities.length === 1 ? mockStepInstance : payload
      }) as never)

      const result = await stepHandler.executeStep(
        mockEm,
        { ...mockInstance, isDryRun: true } as WorkflowInstance,
        'user-task-step',
        { workflowContext: {} }
      )

      expect(result.status).toBe('WAITING')
      expect(result.waitReason).toBe('USER_TASK')
      expect(result.outputData).toEqual({ simulated: true, wouldRaiseTask: 'User Task Step' })
      expect(result.outputData.userTaskId).toBeUndefined()

      const createdNames = createdEntities.map((entity) =>
        typeof entity === 'function' ? entity.name : String(entity)
      )
      expect(createdNames).not.toContain('UserTask')
      // Only the StepInstance and the WorkflowEvent rows the run log needs.
      expect(new Set(createdNames)).toEqual(new Set(['StepInstance', 'WorkflowEvent']))
    })

    test('a dry run reports who the task WOULD have gone to, so the report is actionable', async () => {
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
        enteredAt: new Date(),
        tenantId: testTenantId,
        organizationId: testOrgId,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as StepInstance

      const events: Array<Record<string, unknown>> = []
      let call = 0
      mockEm.create.mockImplementation(((entity: unknown, payload: Record<string, unknown>) => {
        call += 1
        if (typeof payload?.eventType === 'string') events.push(payload)
        return call === 1 ? mockStepInstance : payload
      }) as never)

      await stepHandler.executeStep(
        mockEm,
        { ...mockInstance, isDryRun: true } as WorkflowInstance,
        'user-task-step',
        { workflowContext: {} }
      )

      const simulated = events.find((event) => event.eventType === 'USER_TASK_SIMULATED')
      expect(simulated).toBeDefined()
      expect(events.some((event) => event.eventType === 'USER_TASK_CREATED')).toBe(false)
      expect((simulated?.eventData as Record<string, unknown>).taskName).toBe('User Task Step')
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
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
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as UserTask

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
      const userTaskCall = (mockEm.create as jest.Mock).mock.calls[2] as [string, any] // Third call is user task
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as StepInstance

      const mockUserTask = {
        id: 'user-task-1',
        assignedTo: null,
        assignedToRoles: ['manager', 'admin'],
        tenantId: testTenantId,
        organizationId: testOrgId,
        createdAt: new Date(),
        updatedAt: new Date(),
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

      const userTaskCall = (mockEm.create as jest.Mock).mock.calls[2] as [string, any] // Third call is user task
      expect(userTaskCall[1].assignedTo).toBeNull()
      expect(userTaskCall[1].assignedToRoles).toEqual(['manager', 'admin'])
    })

    const buildDeadlineDefinition = (slaDuration: string) => ({
      ...mockDefinition,
      definition: {
        ...mockDefinition.definition,
        steps: [
          {
            stepId: 'user-task-deadline',
            stepName: 'Deadline Task',
            stepType: 'USER_TASK',
            userTaskConfig: { assignedTo: 'manager@example.com', slaDuration },
          },
        ],
      },
    })

    const primeDeadlineMocks = (slaDuration: string) => {
      const definition = buildDeadlineDefinition(slaDuration)
      mockEm.findOne
        .mockResolvedValueOnce(definition as WorkflowDefinition)
        .mockResolvedValueOnce(definition as WorkflowDefinition)
        .mockResolvedValueOnce(null)

      mockEm.create
        .mockReturnValueOnce({
          id: 'step-instance-1',
          workflowInstanceId: testInstanceId,
          stepId: 'user-task-deadline',
          stepName: 'Deadline Task',
          stepType: 'USER_TASK',
          status: 'ACTIVE',
          tenantId: testTenantId,
          organizationId: testOrgId,
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as StepInstance)
        .mockReturnValueOnce({} as any) // event
        .mockReturnValueOnce({ id: 'user-task-1' } as UserTask)
        .mockReturnValueOnce({} as any) // event
    }

    test('should honour a sub-day deadline instead of defaulting to one day', async () => {
      primeDeadlineMocks('PT30M')
      const before = Date.now()

      await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'user-task-deadline',
        { workflowContext: {} }
      )

      const userTaskCall = (mockEm.create as jest.Mock).mock.calls[2] as [string, any]
      const dueDate = userTaskCall[1].dueDate as Date
      const offsetMs = dueDate.getTime() - before

      expect(offsetMs).toBeGreaterThanOrEqual(30 * 60 * 1000)
      expect(offsetMs).toBeLessThan(31 * 60 * 1000)
    })

    test('should fail the step when the deadline cannot be parsed', async () => {
      primeDeadlineMocks('sometime next week')

      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'user-task-deadline',
        { workflowContext: {} }
      )

      expect(result.status).toBe('FAILED')
      expect(result.error).toContain('sometime next week')
      expect((mockEm.create as jest.Mock).mock.calls).toHaveLength(2)
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
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
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
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

    test('PARALLEL_FORK opens branches and parks the instance in FORKED', async () => {
      const forkDef = {
        ...mockDefinition,
        definition: {
          steps: [
            { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
            { stepId: 'a', stepName: 'A', stepType: 'AUTOMATED' },
            { stepId: 'b', stepName: 'B', stepType: 'AUTOMATED' },
            { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
          ],
          transitions: [
            { transitionId: 't-fa', fromStepId: 'fork', toStepId: 'a', trigger: 'auto' },
            { transitionId: 't-fb', fromStepId: 'fork', toStepId: 'b', trigger: 'auto' },
          ],
        },
      }

      mockEm.findOne
        .mockResolvedValueOnce(forkDef as unknown as WorkflowDefinition) // enterStep
        .mockResolvedValueOnce(forkDef as unknown as WorkflowDefinition) // executeStep
        .mockResolvedValueOnce(forkDef as unknown as WorkflowDefinition) // PARALLEL_FORK case
      mockEm.create.mockImplementation((_entity: any, data: any) => ({ ...(data || {}), id: 'generated' }))

      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'fork',
        { workflowContext: {} }
      )

      expect(result.status).toBe('WAITING')
      expect(result.waitReason).toBe('FORK')
      expect((mockInstance as any).status).toBe('FORKED')
      expect((mockInstance as any).activeForkStepId).toBe('fork')
    })

    test('PARALLEL_JOIN step execution is a no-op completion (synchronization handled by the loop)', async () => {
      const joinDef = {
        ...mockDefinition,
        definition: {
          steps: [
            { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
          ],
          transitions: [],
        },
      }

      mockEm.findOne
        .mockResolvedValueOnce(joinDef as unknown as WorkflowDefinition) // enterStep
        .mockResolvedValueOnce(joinDef as unknown as WorkflowDefinition) // executeStep
      mockEm.create.mockImplementation((_entity: any, data: any) => ({ ...(data || {}), id: 'generated' }))

      const result = await stepHandler.executeStep(
        mockEm,
        mockInstance as WorkflowInstance,
        'join',
        { workflowContext: {} }
      )

      expect(result.status).toBe('COMPLETED')
      expect(result.outputData.stepType).toBe('PARALLEL_JOIN')
    })
  })
})
