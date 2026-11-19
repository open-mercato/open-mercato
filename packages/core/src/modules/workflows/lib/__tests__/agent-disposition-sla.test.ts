/**
 * A breached agent-disposition deadline escalates. It never decides (spec §7.5,
 * maintainer decision 2026-07-29).
 *
 * The task is the same `UserTask` row and the same queue-backed SLA machinery a
 * USER_TASK step uses, so the whole risk lives in ONE branch: which breach
 * vocabulary answers for the step. These tests pin that branch from both sides —
 * an agent step can never route or dispose, and an authored USER_TASK keeps the
 * full §6.1 vocabulary it already had.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import { runTaskSlaJob } from '../task-sla'
import { emitWorkflowsEvent } from '../../events'
import { findDefinitionForInstance } from '../find-definition'
import { StepInstance, UserTask, WorkflowInstance } from '../../data/entities'
import { SLA_BREACH_TRANSITION_KIND } from '../breach-routing'

jest.mock('../activity-executor', () => {
  const actual = jest.requireActual('../activity-executor') as Record<string, unknown>
  return { ...actual, enqueueTaskSlaJob: jest.fn() }
})

jest.mock('../../events', () => {
  const actual = jest.requireActual('../../events') as Record<string, unknown>
  return { ...actual, emitWorkflowsEvent: jest.fn() }
})

jest.mock('../find-definition', () => ({
  findDefinitionForInstance: jest.fn(),
}))

const mockEmit = emitWorkflowsEvent as jest.MockedFunction<typeof emitWorkflowsEvent>
const mockFindDefinition = findDefinitionForInstance as jest.MockedFunction<
  typeof findDefinitionForInstance
>

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const instanceId = '00000000-0000-4000-8000-000000000003'
const stepInstanceId = '00000000-0000-4000-8000-000000000004'
const taskId = '00000000-0000-4000-8000-000000000005'
const stepId = 'enrich_deal'

describe('agent disposition SLA breach', () => {
  let task: Record<string, unknown>
  let instance: Record<string, unknown>
  let mockEm: jest.Mocked<EntityManager>
  let mockLogWorkflowEvent: jest.Mock
  let mockExecuteTransition: jest.Mock
  let mockContainer: { resolve: (token: string) => unknown }

  const jobOptions = {
    userTaskId: taskId,
    stepInstanceId,
    workflowInstanceId: instanceId,
    phase: 'breach' as const,
    deadlineAt: '2026-07-29T14:00:00.000Z',
    tenantId,
    organizationId,
  }

  const setAgentDefinition = (review: unknown, transitions: unknown[] = []) => {
    mockFindDefinition.mockResolvedValue({
      definition: {
        steps: [
          {
            stepId,
            stepType: 'AUTOMATED',
            activities: [
              { activityType: 'INVOKE_AGENT', config: { agentId: 'deal_enricher', review } },
            ],
          },
        ],
        transitions,
      },
    } as never)
  }

  beforeEach(() => {
    jest.clearAllMocks()
    task = {
      id: taskId,
      taskName: 'Dispose agent proposal (deal_enricher)',
      status: 'PENDING',
      assignedTo: null,
      assignedToRoles: ['Sales Rep'],
      claimedBy: null,
      claimedAt: null,
      escalatedAt: null,
      escalatedTo: null,
      reassignedAt: null,
      reassignReason: null,
      entityBindings: null,
      updatedAt: new Date(),
    }
    instance = { id: instanceId, workflowId: 'deal_review', status: 'PAUSED', context: {} }

    mockLogWorkflowEvent = jest.fn<() => Promise<unknown>>().mockResolvedValue({})
    mockExecuteTransition = jest.fn<() => Promise<unknown>>().mockResolvedValue({ success: true })
    mockContainer = {
      resolve: (token: string) => {
        switch (token) {
          case 'eventLogger':
            return { logWorkflowEvent: mockLogWorkflowEvent }
          case 'stepHandler':
            return { exitStep: jest.fn() }
          case 'transitionHandler':
            return { executeTransition: mockExecuteTransition }
          case 'workflowExecutor':
            return { executeWorkflow: jest.fn() }
          default:
            throw new Error(`Unexpected DI token in test: ${token}`)
        }
      },
    }
    mockEm = {
      findOne: jest.fn((entity: unknown) => {
        if (entity === UserTask) return Promise.resolve(task)
        if (entity === StepInstance) {
          return Promise.resolve({ id: stepInstanceId, stepId, status: 'ACTIVE' })
        }
        if (entity === WorkflowInstance) return Promise.resolve(instance)
        return Promise.resolve(null)
      }),
      nativeUpdate: jest.fn<() => Promise<number>>().mockResolvedValue(1),
      flush: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EntityManager>
    mockEmit.mockResolvedValue(undefined as never)
  })

  test('a wired slaBreach transition on an agent step is NOT followed', async () => {
    // The canvas cannot draw this route off an agent node, but a hand-authored
    // or code-defined definition can carry one. Following it would advance the
    // run past a proposal nobody answered — a rejection in everything but name.
    setAgentDefinition(
      { onBreach: { action: 'notify' } },
      [
        {
          transitionId: 't_breach',
          fromStepId: stepId,
          toStepId: 'escalation',
          kind: SLA_BREACH_TRANSITION_KIND,
        },
      ],
    )

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, jobOptions)

    expect(outcome).toBe('breached')
    expect(mockExecuteTransition).not.toHaveBeenCalled()
    expect(task.status).toBe('PENDING')
    expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({
        eventType: 'USER_TASK_DEADLINE_BREACHED',
        eventData: expect.objectContaining({ onBreach: 'notified' }),
      }),
    )
  })

  test('no breach action authored records the breach and changes nothing else', async () => {
    setAgentDefinition(null)

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, jobOptions)

    expect(outcome).toBe('breached')
    expect(mockExecuteTransition).not.toHaveBeenCalled()
    expect(task.status).toBe('PENDING')
    expect(instance.status).toBe('PAUSED')
  })

  test('reassign moves the queue without touching the proposal', async () => {
    setAgentDefinition({ onBreach: { action: 'reassign', reassignTo: 'Supervisor' } })

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, jobOptions)

    expect(outcome).toBe('breached')
    expect(task.assignedToRoles).toEqual(['Supervisor'])
    expect(task.reassignReason).toBe('sla_breach')
    expect(task.status).toBe('PENDING')
    expect(mockEmit).toHaveBeenCalledWith(
      'workflows.task.assigned',
      expect.objectContaining({ taskId }),
      { persistent: true },
    )
  })

  test('attention marks the run for triage without moving its state machine', async () => {
    setAgentDefinition({ onBreach: { action: 'attention' } })

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, jobOptions)

    expect(outcome).toBe('breached')
    expect(instance.metadata).toEqual({
      attention: expect.objectContaining({ reason: 'DISPOSITION_SLA_BREACH', stepId }),
    })
    // The run was already parked on the proposal-ready signal; a late reviewer
    // is not a failure, so neither the status nor an error message moves.
    expect(instance.status).toBe('PAUSED')
    expect(instance.errorMessage).toBeUndefined()
    expect(task.status).toBe('PENDING')
    expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({ eventData: expect.objectContaining({ onBreach: 'attention' }) }),
    )
  })

  test('an authored USER_TASK step keeps the full breach vocabulary', async () => {
    mockFindDefinition.mockResolvedValue({
      definition: {
        steps: [{ stepId, stepType: 'USER_TASK', userTaskConfig: { onBreach: null } }],
        transitions: [
          {
            transitionId: 't_breach',
            fromStepId: stepId,
            toStepId: 'escalation',
            kind: SLA_BREACH_TRANSITION_KIND,
          },
        ],
      },
    } as never)

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, jobOptions)

    expect(outcome).toBe('breached')
    expect(mockExecuteTransition).toHaveBeenCalled()
    expect(task.status).toBe('ESCALATED')
  })
})
