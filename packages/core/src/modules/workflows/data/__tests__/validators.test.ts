import { describe, test, expect } from '@jest/globals'
import {
  workflowStepTypeSchema,
  workflowInstanceStatusSchema,
  stepInstanceStatusSchema,
  userTaskStatusSchema,
  transitionTriggerSchema,
  activityTypeSchema,
  workflowStepSchema,
  workflowTransitionSchema,
  activityDefinitionSchema,
  createWorkflowDefinitionSchema,
  updateWorkflowDefinitionSchema,
  workflowDefinitionFilterSchema,
  createWorkflowInstanceSchema,
  updateWorkflowInstanceSchema,
  createStepInstanceSchema,
  createUserTaskSchema,
  createWorkflowEventSchema,
  type CreateWorkflowDefinitionInput,
  type CreateWorkflowInstanceInput,
  type CreateStepInstanceInput,
  type CreateUserTaskInput,
} from '../validators'

describe('Workflows Validators', () => {
  describe('workflowStepTypeSchema', () => {
    test('should accept valid step types', () => {
      expect(workflowStepTypeSchema.parse('START')).toBe('START')
      expect(workflowStepTypeSchema.parse('END')).toBe('END')
      expect(workflowStepTypeSchema.parse('USER_TASK')).toBe('USER_TASK')
      expect(workflowStepTypeSchema.parse('AUTOMATED')).toBe('AUTOMATED')
      expect(workflowStepTypeSchema.parse('PARALLEL_FORK')).toBe('PARALLEL_FORK')
      expect(workflowStepTypeSchema.parse('PARALLEL_JOIN')).toBe('PARALLEL_JOIN')
      expect(workflowStepTypeSchema.parse('SUB_WORKFLOW')).toBe('SUB_WORKFLOW')
      expect(workflowStepTypeSchema.parse('WAIT_FOR_SIGNAL')).toBe('WAIT_FOR_SIGNAL')
      expect(workflowStepTypeSchema.parse('WAIT_FOR_TIMER')).toBe('WAIT_FOR_TIMER')
    })

    test('should reject invalid step types', () => {
      expect(() => workflowStepTypeSchema.parse('INVALID')).toThrow()
    })
  })

  describe('workflowInstanceStatusSchema', () => {
    test('should accept valid instance statuses', () => {
      expect(workflowInstanceStatusSchema.parse('RUNNING')).toBe('RUNNING')
      expect(workflowInstanceStatusSchema.parse('PAUSED')).toBe('PAUSED')
      expect(workflowInstanceStatusSchema.parse('COMPLETED')).toBe('COMPLETED')
      expect(workflowInstanceStatusSchema.parse('FAILED')).toBe('FAILED')
      expect(workflowInstanceStatusSchema.parse('CANCELLED')).toBe('CANCELLED')
      expect(workflowInstanceStatusSchema.parse('COMPENSATING')).toBe('COMPENSATING')
      expect(workflowInstanceStatusSchema.parse('COMPENSATED')).toBe('COMPENSATED')
    })

    test('should reject invalid instance statuses', () => {
      expect(() => workflowInstanceStatusSchema.parse('INVALID')).toThrow()
    })
  })

  describe('stepInstanceStatusSchema', () => {
    test('should accept valid step statuses', () => {
      expect(stepInstanceStatusSchema.parse('PENDING')).toBe('PENDING')
      expect(stepInstanceStatusSchema.parse('ACTIVE')).toBe('ACTIVE')
      expect(stepInstanceStatusSchema.parse('COMPLETED')).toBe('COMPLETED')
      expect(stepInstanceStatusSchema.parse('FAILED')).toBe('FAILED')
      expect(stepInstanceStatusSchema.parse('SKIPPED')).toBe('SKIPPED')
      expect(stepInstanceStatusSchema.parse('CANCELLED')).toBe('CANCELLED')
    })

    test('should reject invalid step statuses', () => {
      expect(() => stepInstanceStatusSchema.parse('INVALID')).toThrow()
    })
  })

  describe('userTaskStatusSchema', () => {
    test('should accept valid task statuses', () => {
      expect(userTaskStatusSchema.parse('PENDING')).toBe('PENDING')
      expect(userTaskStatusSchema.parse('IN_PROGRESS')).toBe('IN_PROGRESS')
      expect(userTaskStatusSchema.parse('COMPLETED')).toBe('COMPLETED')
      expect(userTaskStatusSchema.parse('CANCELLED')).toBe('CANCELLED')
      expect(userTaskStatusSchema.parse('ESCALATED')).toBe('ESCALATED')
    })

    test('should reject invalid task statuses', () => {
      expect(() => userTaskStatusSchema.parse('INVALID')).toThrow()
    })
  })

  describe('transitionTriggerSchema', () => {
    test('should accept valid triggers', () => {
      expect(transitionTriggerSchema.parse('auto')).toBe('auto')
      expect(transitionTriggerSchema.parse('manual')).toBe('manual')
      expect(transitionTriggerSchema.parse('signal')).toBe('signal')
      expect(transitionTriggerSchema.parse('timer')).toBe('timer')
    })

    test('should reject invalid triggers', () => {
      expect(() => transitionTriggerSchema.parse('INVALID')).toThrow()
    })
  })

  describe('activityTypeSchema', () => {
    test('should accept valid activity types', () => {
      expect(activityTypeSchema.parse('SEND_EMAIL')).toBe('SEND_EMAIL')
      expect(activityTypeSchema.parse('CALL_API')).toBe('CALL_API')
      expect(activityTypeSchema.parse('UPDATE_ENTITY')).toBe('UPDATE_ENTITY')
      expect(activityTypeSchema.parse('EMIT_EVENT')).toBe('EMIT_EVENT')
      expect(activityTypeSchema.parse('CALL_WEBHOOK')).toBe('CALL_WEBHOOK')
      expect(activityTypeSchema.parse('EXECUTE_FUNCTION')).toBe('EXECUTE_FUNCTION')
      expect(activityTypeSchema.parse('WAIT')).toBe('WAIT')
    })

    test('should reject invalid activity types', () => {
      expect(() => activityTypeSchema.parse('INVALID')).toThrow()
    })
  })

  describe('workflowStepSchema', () => {
    const validStep = {
      stepId: 'start-step',
      stepName: 'Start',
      stepType: 'START' as const,
      description: 'Initial step',
      config: { autoStart: true },
    }

    test('should validate a complete step', () => {
      const result = workflowStepSchema.parse(validStep)
      expect(result.stepId).toBe('start-step')
      expect(result.stepName).toBe('Start')
      expect(result.stepType).toBe('START')
    })

    test('should reject invalid stepId format', () => {
      const invalidId = {
        ...validStep,
        stepId: 'InvalidStep!', // Contains uppercase and special chars
      }

      expect(() => workflowStepSchema.parse(invalidId)).toThrow()
    })

    test('should validate step with user task config', () => {
      const userTaskStep = {
        stepId: 'approve-order',
        stepName: 'Approve Order',
        stepType: 'USER_TASK' as const,
        userTaskConfig: {
          formSchema: {
            fields: [
              { name: 'approved', type: 'boolean', label: 'Approved', required: true },
              { name: 'comments', type: 'text', label: 'Comments' },
            ],
          },
          assignedTo: 'manager@example.com',
          slaDuration: 'P1D', // 1 day
        },
      }

      const result = workflowStepSchema.parse(userTaskStep)
      expect(result.userTaskConfig?.assignedTo).toBe('manager@example.com')
      expect(result.userTaskConfig?.slaDuration).toBe('P1D')
    })

    test('should validate step with retry policy', () => {
      const stepWithRetry = {
        ...validStep,
        retryPolicy: {
          maxAttempts: 3,
          backoffMs: 1000,
        },
      }

      const result = workflowStepSchema.parse(stepWithRetry)
      expect(result.retryPolicy?.maxAttempts).toBe(3)
      expect(result.retryPolicy?.backoffMs).toBe(1000)
    })
  })

  describe('workflowTransitionSchema', () => {
    const validTransition = {
      transitionId: 'start-to-approve',
      fromStepId: 'start',
      toStepId: 'approve',
      transitionName: 'Begin Approval',
      trigger: 'auto' as const,
      priority: 0,
    }

    test('should validate a complete transition', () => {
      const result = workflowTransitionSchema.parse(validTransition)
      expect(result.transitionId).toBe('start-to-approve')
      expect(result.fromStepId).toBe('start')
      expect(result.toStepId).toBe('approve')
      expect(result.trigger).toBe('auto')
    })

    test('should reject invalid transitionId format', () => {
      const invalidId = {
        ...validTransition,
        transitionId: 'Invalid Transition!',
      }

      expect(() => workflowTransitionSchema.parse(invalidId)).toThrow()
    })

    test('should validate transition with pre-conditions', () => {
      const withConditions = {
        ...validTransition,
        preConditions: [
          { ruleId: 'check-inventory', required: true },
          { ruleId: 'validate-price', required: true },
        ],
      }

      const result = workflowTransitionSchema.parse(withConditions)
      expect(result.preConditions).toHaveLength(2)
      expect(result.preConditions?.[0].ruleId).toBe('check-inventory')
    })

    test('should validate transition with activities', () => {
      const withActivities = {
        ...validTransition,
        activities: [
          {
            activityName: 'Send Notification',
            activityType: 'SEND_EMAIL',
            config: { to: 'user@example.com', subject: 'Test' },
          },
          {
            activityName: 'Update Inventory',
            activityType: 'UPDATE_ENTITY',
            config: { entityType: 'inventory', updates: { count: 10 } },
          },
        ],
      }

      const result = workflowTransitionSchema.parse(withActivities)
      expect(result.activities).toHaveLength(2)
      expect(result.activities?.[0].activityType).toBe('SEND_EMAIL')
    })
  })

  describe('activityDefinitionSchema', () => {
    const validActivity = {
      activityName: 'Send Email Notification',
      activityType: 'SEND_EMAIL' as const,
      config: {
        to: '{{customer.email}}',
        subject: 'Order Confirmation',
        template: 'order-confirmation',
      },
      async: false,
    }

    test('should validate a complete activity', () => {
      const result = activityDefinitionSchema.parse(validActivity)
      expect(result.activityName).toBe('Send Email Notification')
      expect(result.activityType).toBe('SEND_EMAIL')
      expect(result.async).toBe(false)
    })

    test('should validate activity with retry policy', () => {
      const withRetry = {
        ...validActivity,
        retryPolicy: {
          maxAttempts: 5,
          initialIntervalMs: 1000,
          backoffCoefficient: 2,
          maxIntervalMs: 60000,
        },
      }

      const result = activityDefinitionSchema.parse(withRetry)
      expect(result.retryPolicy?.maxAttempts).toBe(5)
      expect(result.retryPolicy?.backoffCoefficient).toBe(2)
    })

    test('should validate activity with compensation flag', () => {
      const withCompensation = {
        ...validActivity,
        compensation: { activityId: 'rollback-1', config: {} },
      }

      const result = activityDefinitionSchema.parse(withCompensation)
      expect(result.compensation).toBeDefined()
    })
  })

  describe('createWorkflowDefinitionSchema', () => {
    const validDefinition: CreateWorkflowDefinitionInput = {
      workflowId: 'simple-approval',
      workflowName: 'Simple Approval Workflow',
      description: 'A basic approval workflow',
      version: 1,
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
      metadata: {
        tags: ['approval', 'simple'],
        category: 'workflow',
      },
      enabled: true,
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: '123e4567-e89b-12d3-a456-426614174001',
    }

    test('should validate a complete workflow definition', () => {
      const result = createWorkflowDefinitionSchema.parse(validDefinition)
      expect(result.workflowId).toBe('simple-approval')
      expect(result.workflowName).toBe('Simple Approval Workflow')
      expect(result.version).toBe(1)
      expect(result.enabled).toBe(true)
      expect(result.definition.steps).toHaveLength(2)
      expect(result.definition.transitions).toHaveLength(1)
    })

    test('should apply default values', () => {
      const minimal = {
        workflowId: 'minimal-workflow',
        workflowName: 'Minimal Workflow',
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
            { stepId: 'end', stepName: 'End', stepType: 'END' as const },
          ],
          transitions: [
            {
              transitionId: 'start-to-end',
              fromStepId: 'start',
              toStepId: 'end',
              trigger: 'auto' as const,
              priority: 0,
            },
          ],
        },
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createWorkflowDefinitionSchema.parse(minimal)
      expect(result.version).toBe(1)
      expect(result.enabled).toBe(true)
    })

    test('should reject missing required fields', () => {
      const invalid = {
        workflowName: 'Missing Workflow ID',
      }

      expect(() => createWorkflowDefinitionSchema.parse(invalid)).toThrow()
    })

    test('should validate workflowId format', () => {
      const invalidId = {
        ...validDefinition,
        workflowId: 'Invalid Workflow!',
      }

      expect(() => createWorkflowDefinitionSchema.parse(invalidId)).toThrow()
    })

    test('should validate workflowId length', () => {
      const tooLong = {
        ...validDefinition,
        workflowId: 'a'.repeat(101),
      }

      expect(() => createWorkflowDefinitionSchema.parse(tooLong)).toThrow()
    })

    test('should validate workflowName length', () => {
      const tooLong = {
        ...validDefinition,
        workflowName: 'A'.repeat(256),
      }

      expect(() => createWorkflowDefinitionSchema.parse(tooLong)).toThrow()
    })

    test('should validate description length', () => {
      const tooLong = {
        ...validDefinition,
        description: 'A'.repeat(2001),
      }

      expect(() => createWorkflowDefinitionSchema.parse(tooLong)).toThrow()
    })

    test('should validate UUID format', () => {
      const invalidUuid = {
        ...validDefinition,
        tenantId: 'not-a-uuid',
      }

      expect(() => createWorkflowDefinitionSchema.parse(invalidUuid)).toThrow()
    })

    test('should require at least 2 steps', () => {
      const tooFewSteps = {
        ...validDefinition,
        definition: {
          steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' as const }],
          transitions: [],
        },
      }

      expect(() => createWorkflowDefinitionSchema.parse(tooFewSteps)).toThrow()
    })

    test('should require at least 1 transition', () => {
      const noTransitions = {
        ...validDefinition,
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
            { stepId: 'end', stepName: 'End', stepType: 'END' as const },
          ],
          transitions: [],
        },
      }

      expect(() => createWorkflowDefinitionSchema.parse(noTransitions)).toThrow()
    })

    test('should accept null/undefined for optional fields', () => {
      const withNulls = {
        ...validDefinition,
        description: null,
        metadata: null,
        effectiveFrom: null,
        effectiveTo: null,
        createdBy: null,
      }

      const result = createWorkflowDefinitionSchema.parse(withNulls)
      expect(result.description).toBeNull()
      expect(result.metadata).toBeNull()
    })
  })

  describe('updateWorkflowDefinitionSchema', () => {
    test('should make all fields optional except id', () => {
      const minimalUpdate = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        workflowName: 'Updated Name',
      }

      const result = updateWorkflowDefinitionSchema.parse(minimalUpdate)
      expect(result.id).toBe('123e4567-e89b-12d3-a456-426614174000')
      expect(result.workflowName).toBe('Updated Name')
    })

    test('should require id field', () => {
      const noId = {
        workflowName: 'Updated Name',
      }

      expect(() => updateWorkflowDefinitionSchema.parse(noId)).toThrow()
    })
  })

  describe('workflowDefinitionFilterSchema', () => {
    test('should validate filter with all fields', () => {
      const filter = {
        workflowId: 'simple-approval',
        workflowName: 'Simple Approval',
        enabled: true,
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = workflowDefinitionFilterSchema.parse(filter)
      expect(result.workflowId).toBe('simple-approval')
      expect(result.enabled).toBe(true)
    })

    test('should validate empty filter', () => {
      const result = workflowDefinitionFilterSchema.parse({})
      expect(result).toEqual({})
    })

    test('should validate partial filter', () => {
      const filter = {
        enabled: false,
      }

      const result = workflowDefinitionFilterSchema.parse(filter)
      expect(result.enabled).toBe(false)
    })
  })

  describe('createWorkflowInstanceSchema', () => {
    const validInstance: CreateWorkflowInstanceInput = {
      definitionId: '123e4567-e89b-12d3-a456-426614174002',
      workflowId: 'simple-approval',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'start',
      context: { orderId: '12345', customer: 'John Doe' },
      correlationKey: 'order-12345',
      metadata: {
        entityType: 'Order',
        entityId: '12345',
        initiatedBy: 'system',
      },
      startedAt: new Date('2025-01-01T10:00:00Z'),
      retryCount: 0,
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: '123e4567-e89b-12d3-a456-426614174001',
    }

    test('should validate a complete workflow instance', () => {
      const result = createWorkflowInstanceSchema.parse(validInstance)
      expect(result.workflowId).toBe('simple-approval')
      expect(result.status).toBe('RUNNING')
      expect(result.currentStepId).toBe('start')
      expect(result.context.orderId).toBe('12345')
    })

    test('should apply default values', () => {
      const minimal = {
        definitionId: '123e4567-e89b-12d3-a456-426614174002',
        workflowId: 'simple-approval',
        version: 1,
        status: 'RUNNING' as const,
        currentStepId: 'start',
        context: {},
        startedAt: new Date(),
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createWorkflowInstanceSchema.parse(minimal)
      expect(result.retryCount).toBe(0)
    })

    test('should reject missing required fields', () => {
      const invalid = {
        workflowId: 'simple-approval',
      }

      expect(() => createWorkflowInstanceSchema.parse(invalid)).toThrow()
    })

    test('should validate UUID format', () => {
      const invalidUuid = {
        ...validInstance,
        definitionId: 'not-a-uuid',
      }

      expect(() => createWorkflowInstanceSchema.parse(invalidUuid)).toThrow()
    })
  })

  describe('createStepInstanceSchema', () => {
    const validStepInstance: CreateStepInstanceInput = {
      workflowInstanceId: '123e4567-e89b-12d3-a456-426614174003',
      stepId: 'approve',
      stepName: 'Approve Order',
      stepType: 'USER_TASK',
      status: 'ACTIVE',
      inputData: { orderId: '12345' },
      outputData: null,
      errorData: null,
      enteredAt: new Date('2025-01-01T10:00:00Z'),
      exitedAt: null,
      executionTimeMs: null,
      retryCount: 0,
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: '123e4567-e89b-12d3-a456-426614174001',
    }

    test('should validate a complete step instance', () => {
      const result = createStepInstanceSchema.parse(validStepInstance)
      expect(result.stepId).toBe('approve')
      expect(result.stepName).toBe('Approve Order')
      expect(result.stepType).toBe('USER_TASK')
      expect(result.status).toBe('ACTIVE')
    })

    test('should apply default values', () => {
      const minimal = {
        workflowInstanceId: '123e4567-e89b-12d3-a456-426614174003',
        stepId: 'approve',
        stepName: 'Approve',
        stepType: 'USER_TASK',
        status: 'ACTIVE' as const,
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createStepInstanceSchema.parse(minimal)
      expect(result.retryCount).toBe(0)
    })
  })

  describe('createUserTaskSchema', () => {
    const validUserTask: CreateUserTaskInput = {
      workflowInstanceId: '123e4567-e89b-12d3-a456-426614174003',
      stepInstanceId: '123e4567-e89b-12d3-a456-426614174004',
      taskName: 'Approve Order',
      description: 'Review and approve order #12345',
      status: 'PENDING',
      formSchema: {
        fields: [
          { name: 'approved', type: 'boolean', label: 'Approved', required: true },
        ],
      },
      formData: null,
      assignedTo: 'manager@example.com',
      assignedToRoles: ['manager', 'admin'],
      claimedBy: null,
      claimedAt: null,
      dueDate: new Date('2025-01-02T10:00:00Z'),
      escalatedAt: null,
      escalatedTo: null,
      completedBy: null,
      completedAt: null,
      comments: null,
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: '123e4567-e89b-12d3-a456-426614174001',
    }

    test('should validate a complete user task', () => {
      const result = createUserTaskSchema.parse(validUserTask)
      expect(result.taskName).toBe('Approve Order')
      expect(result.status).toBe('PENDING')
      expect(result.assignedTo).toBe('manager@example.com')
      expect(result.assignedToRoles).toEqual(['manager', 'admin'])
    })

    test('should reject missing required fields', () => {
      const invalid = {
        taskName: 'Approve Order',
      }

      expect(() => createUserTaskSchema.parse(invalid)).toThrow()
    })

    test('should validate UUID format', () => {
      const invalidUuid = {
        ...validUserTask,
        workflowInstanceId: 'not-a-uuid',
      }

      expect(() => createUserTaskSchema.parse(invalidUuid)).toThrow()
    })
  })

  describe('createWorkflowEventSchema', () => {
    test('should validate a complete workflow event', () => {
      const validEvent = {
        workflowInstanceId: '123e4567-e89b-12d3-a456-426614174003',
        stepInstanceId: '123e4567-e89b-12d3-a456-426614174004',
        eventType: 'STEP_ENTERED',
        eventData: { stepId: 'approve', timestamp: new Date().toISOString() },
        occurredAt: new Date(),
        userId: 'user-123',
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createWorkflowEventSchema.parse(validEvent)
      expect(result.eventType).toBe('STEP_ENTERED')
      expect(result.eventData.stepId).toBe('approve')
    })

    test('should allow null stepInstanceId', () => {
      const eventWithoutStep = {
        workflowInstanceId: '123e4567-e89b-12d3-a456-426614174003',
        stepInstanceId: null,
        eventType: 'WORKFLOW_STARTED',
        eventData: { initiatedBy: 'system' },
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createWorkflowEventSchema.parse(eventWithoutStep)
      expect(result.stepInstanceId).toBeNull()
    })
  })
})
