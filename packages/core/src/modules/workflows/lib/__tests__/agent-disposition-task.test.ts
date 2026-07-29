/**
 * The implicit agent-disposition task (spec §7.5).
 *
 * Before the Review section existed this row was created unassigned, with no
 * role queue, no audit event and no assignment event — which under §6.4 makes
 * it visible only to administrative oversight and actable by NOBODY. These
 * tests pin the three things that fix:
 *  - the authored assignment reaches the row;
 *  - the row is addressed to the step instance, not to the workflow instance;
 *  - `USER_TASK_CREATED` and `workflows.task.assigned` both fire, so the task
 *    is auditable and the notification subscriber can reach it.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import { createAgentDispositionTask } from '../agent-disposition-task'
import { emitWorkflowsEvent } from '../../events'
import { scheduleUserTaskSla } from '../task-sla'
import { StepInstance, WorkflowInstance } from '../../data/entities'

jest.mock('../../events', () => {
  const actual = jest.requireActual('../../events') as Record<string, unknown>
  return { ...actual, emitWorkflowsEvent: jest.fn() }
})

jest.mock('../task-sla', () => {
  const actual = jest.requireActual('../task-sla') as Record<string, unknown>
  return { ...actual, scheduleUserTaskSla: jest.fn() }
})

const mockEmit = emitWorkflowsEvent as jest.MockedFunction<typeof emitWorkflowsEvent>
const mockSchedule = scheduleUserTaskSla as jest.MockedFunction<typeof scheduleUserTaskSla>

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const instanceId = '00000000-0000-4000-8000-000000000003'
const stepInstanceId = '00000000-0000-4000-8000-000000000004'
const proposalId = '00000000-0000-4000-8000-000000000005'

describe('createAgentDispositionTask', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockLogWorkflowEvent: jest.Mock
  let mockContainer: { resolve: (token: string) => unknown }
  let created: Record<string, unknown>[]

  const baseOptions = {
    workflowInstanceId: instanceId,
    stepId: 'agent_step',
    proposalId,
    agentId: 'deal_enricher',
    proposalPayload: { actions: [{ type: 'update' }] },
    confidence: 0.42,
    taskName: 'Dispose agent proposal (deal_enricher)',
    description: 'Review and approve, edit, or reject the agent proposal.',
    tenantId,
    organizationId,
    now: new Date('2026-07-29T10:00:00.000Z'),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    created = []
    mockLogWorkflowEvent = jest.fn<() => Promise<unknown>>().mockResolvedValue({})
    mockContainer = {
      resolve: (token: string) => {
        if (token === 'eventLogger') return { logWorkflowEvent: mockLogWorkflowEvent }
        throw new Error(`Unexpected DI token in test: ${token}`)
      },
    }
    mockEm = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === WorkflowInstance) {
          return { id: instanceId, workflowId: 'deal_review', tenantId, organizationId }
        }
        if (entity === StepInstance) {
          return { id: stepInstanceId, branchInstanceId: null }
        }
        return null
      }),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
        const row = { id: 'task-1', ...data }
        created.push(row)
        return row
      }),
      persist: jest.fn(),
      flush: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>
    mockEmit.mockResolvedValue(undefined as never)
    mockSchedule.mockResolvedValue([] as never)
  })

  test('carries the authored assignment, priority and deadline onto the row', async () => {
    const result = await createAgentDispositionTask(mockEm, mockContainer as never, {
      ...baseOptions,
      review: {
        assignedTo: 'user-1',
        assignedToRoles: ['Sales Rep'],
        priority: 'high',
        deadlineDuration: 'P2D',
      },
    })

    expect(result.userTaskId).toBe('task-1')
    expect(created[0]).toMatchObject({
      assignedTo: 'user-1',
      assignedToRoles: ['Sales Rep'],
      assigneeKind: 'user',
      priority: 'high',
      status: 'PENDING',
      formSchema: { proposalId, payload: baseOptions.proposalPayload, confidence: 0.42 },
    })
    expect((created[0].dueDate as Date).toISOString()).toBe('2026-07-31T10:00:00.000Z')
  })

  test('no Review authored still creates the task, unassigned and undated', async () => {
    await createAgentDispositionTask(mockEm, mockContainer as never, baseOptions)

    expect(created[0]).toMatchObject({
      assignedTo: null,
      assignedToRoles: null,
      priority: null,
      dueDate: null,
    })
  })

  test('the row is addressed to the step instance', async () => {
    const result = await createAgentDispositionTask(mockEm, mockContainer as never, baseOptions)
    expect(result.stepInstanceId).toBe(stepInstanceId)
    expect(created[0].stepInstanceId).toBe(stepInstanceId)
  })

  test('an unparseable deadline costs the deadline, never the task', async () => {
    await createAgentDispositionTask(mockEm, mockContainer as never, {
      ...baseOptions,
      review: { assignedToRoles: ['Sales Rep'], deadlineDuration: 'not-a-duration' },
    })

    expect(created).toHaveLength(1)
    expect(created[0].dueDate).toBeNull()
    expect(created[0].assignedToRoles).toEqual(['Sales Rep'])
  })

  test('audits the creation and announces the assignment', async () => {
    await createAgentDispositionTask(mockEm, mockContainer as never, {
      ...baseOptions,
      review: { assignedToRoles: ['Sales Rep'] },
    })

    expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({
        eventType: 'USER_TASK_CREATED',
        eventData: expect.objectContaining({ proposalId, agentId: 'deal_enricher' }),
      }),
    )
    expect(mockEmit).toHaveBeenCalledWith(
      'workflows.task.assigned',
      expect.objectContaining({ taskId: 'task-1', assignedToRoles: ['Sales Rep'] }),
      { persistent: true },
    )
  })

  test('schedules the reminders and the deadline breach against the created task', async () => {
    await createAgentDispositionTask(mockEm, mockContainer as never, {
      ...baseOptions,
      review: { deadlineDuration: 'P2D', reminders: [{ offset: 'PT4H' }] },
    })

    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        userTaskId: 'task-1',
        stepInstanceId,
        reminders: [{ offset: 'PT4H' }],
        now: baseOptions.now,
      }),
    )
    const scheduled = mockSchedule.mock.calls[0][0]
    expect((scheduled.dueDate as Date).toISOString()).toBe('2026-07-31T10:00:00.000Z')
  })

  test('no deadline schedules nothing', async () => {
    await createAgentDispositionTask(mockEm, mockContainer as never, {
      ...baseOptions,
      review: { assignedToRoles: ['Sales Rep'] },
    })

    expect(mockSchedule).toHaveBeenCalledWith(expect.objectContaining({ dueDate: null }))
  })

  test('a missing workflow instance refuses rather than writing an orphan row', async () => {
    ;(mockEm.findOne as jest.Mock).mockResolvedValue(null as never)

    await expect(
      createAgentDispositionTask(mockEm, mockContainer as never, baseOptions),
    ).rejects.toThrow(/workflow instance/)
    expect(created).toHaveLength(0)
  })
})
