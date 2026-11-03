import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'

const mockEmit = jest.fn<(...args: unknown[]) => Promise<void>>()

jest.mock('../../events', () => {
  const actual = jest.requireActual('../../events') as Record<string, unknown>
  return { ...actual, emitWorkflowsEvent: (...args: unknown[]) => mockEmit(...args) }
})

import * as stepHandler from '../step-handler'
import { eventsConfig } from '../../events'
import type { StepInstance, UserTask, WorkflowDefinition, WorkflowInstance } from '../../data/entities'

/**
 * Regression suite for A4: `workflows.task.assigned` was declared in
 * `notifications.ts` and subscribed in `subscribers/task-assigned-notification.ts`
 * but was declared in no `events.ts` and emitted from nowhere — so assignment
 * notifications never fired at all.
 */

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const ORG_ID = '00000000-0000-4000-8000-000000000002'
const DEFINITION_ID = '00000000-0000-4000-8000-000000000003'
const INSTANCE_ID = '00000000-0000-4000-8000-000000000004'

function buildDefinition(userTaskConfig: Record<string, unknown>): Partial<WorkflowDefinition> {
  return {
    id: DEFINITION_ID,
    workflowId: 'invoice-approval',
    workflowName: 'Invoice Approval',
    version: 1,
    enabled: true,
    definition: {
      steps: [
        {
          stepId: 'approve',
          stepName: 'Approve Invoice',
          stepType: 'USER_TASK',
          userTaskConfig,
        },
      ],
      transitions: [],
    } as any,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
  }
}

const instance: Partial<WorkflowInstance> = {
  id: INSTANCE_ID,
  definitionId: DEFINITION_ID,
  workflowId: 'invoice-approval',
  version: 1,
  status: 'RUNNING',
  currentStepId: 'approve',
  context: {},
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  startedAt: new Date(),
}

describe('workflows.task.assigned', () => {
  let mockEm: jest.Mocked<EntityManager>

  const runUserTaskStep = async (userTaskConfig: Record<string, unknown>, task: Partial<UserTask>) => {
    const definition = buildDefinition(userTaskConfig)
    mockEm.findOne
      .mockResolvedValueOnce(definition as WorkflowDefinition)
      .mockResolvedValueOnce(definition as WorkflowDefinition)

    mockEm.create
      .mockReturnValueOnce({
        id: 'step-instance-1',
        workflowInstanceId: INSTANCE_ID,
        stepId: 'approve',
        stepName: 'Approve Invoice',
        stepType: 'USER_TASK',
        status: 'ACTIVE',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as StepInstance)
      .mockReturnValueOnce({} as any)
      .mockReturnValueOnce(task as UserTask)
      .mockReturnValueOnce({} as any)

    return stepHandler.executeStep(
      mockEm,
      instance as WorkflowInstance,
      'approve',
      { workflowContext: {} }
    )
  }

  beforeEach(() => {
    mockEmit.mockReset()
    mockEmit.mockResolvedValue(undefined)
    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      persist: jest.fn(function persist(this: any) { return this }),
      flush: jest.fn(),
      nativeDelete: jest.fn(),
    } as any
  })

  test('is declared in events.ts so the emit is not rejected as undeclared', () => {
    const declared = eventsConfig.events.find((event) => event.id === 'workflows.task.assigned')

    expect(declared).toBeDefined()
    expect(declared?.module).toBe('workflows')
  })

  test('is emitted when a user-assigned task is created', async () => {
    const dueDate = new Date('2026-07-30T09:00:00.000Z')
    await runUserTaskStep(
      { assignedTo: 'user-1', slaDuration: 'PT2H' },
      { id: 'task-1', taskName: 'Approve Invoice', assignedTo: 'user-1', assignedToRoles: null, dueDate }
    )

    expect(mockEmit).toHaveBeenCalledTimes(1)
    const [eventId, payload] = mockEmit.mock.calls[0] as [string, any]
    expect(eventId).toBe('workflows.task.assigned')
    expect(payload).toMatchObject({
      taskId: 'task-1',
      taskName: 'Approve Invoice',
      workflowName: 'Invoice Approval',
      assignedUserId: 'user-1',
      assignedToRoles: null,
      dueDate: dueDate.toISOString(),
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  test('carries the role queue so role-assigned tasks can notify somebody', async () => {
    await runUserTaskStep(
      { assignedToRoles: ['Approver'] },
      {
        id: 'task-2',
        taskName: 'Approve Invoice',
        assignedTo: null,
        assignedToRoles: ['Approver'],
        dueDate: null,
      }
    )

    const [, payload] = mockEmit.mock.calls[0] as [string, any]
    expect(payload.assignedUserId).toBeNull()
    expect(payload.assignedToRoles).toEqual(['Approver'])
  })

  test('a bus failure never breaks step execution', async () => {
    mockEmit.mockRejectedValue(new Error('bus down'))

    const result = await runUserTaskStep(
      { assignedTo: 'user-1' },
      { id: 'task-3', taskName: 'Approve Invoice', assignedTo: 'user-1', assignedToRoles: null, dueDate: null }
    )

    expect(result.status).toBe('WAITING')
    expect(result.waitReason).toBe('USER_TASK')
  })
})
