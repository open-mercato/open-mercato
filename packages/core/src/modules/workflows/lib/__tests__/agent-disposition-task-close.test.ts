/**
 * Closing the review task a disposed proposal no longer needs (A7).
 *
 * The rule this file guards is a NEGATIVE one: closing a task and advancing a
 * workflow are different acts. This helper does the first and must never do the
 * second — the run resumes on `agent_orchestrator.proposal.ready`, and a second
 * advance path would double-execute the step's outgoing transition.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import { closeAgentDispositionTask } from '../agent-disposition-task'
import { UserTask } from '../../data/entities'

jest.mock('../task-sla', () => {
  const actual = jest.requireActual('../task-sla') as Record<string, unknown>
  return { ...actual, scheduleUserTaskSla: jest.fn() }
})

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const taskId = '00000000-0000-4000-8000-000000000005'

describe('closeAgentDispositionTask', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockLogWorkflowEvent: jest.Mock
  let mockContainer: { resolve: (token: string) => unknown }
  let task: Record<string, unknown> | null

  const options = {
    userTaskId: taskId,
    disposition: 'approved',
    closedBy: 'user-1',
    tenantId,
    organizationId,
    now: new Date('2026-07-29T12:00:00.000Z'),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    task = {
      id: taskId,
      taskName: 'Dispose agent proposal (deal_enricher)',
      status: 'PENDING',
      workflowInstanceId: '00000000-0000-4000-8000-000000000003',
      stepInstanceId: '00000000-0000-4000-8000-000000000004',
      branchInstanceId: null,
    }
    mockLogWorkflowEvent = jest.fn<() => Promise<unknown>>().mockResolvedValue({})
    mockContainer = {
      resolve: (token: string) => {
        if (token === 'eventLogger') return { logWorkflowEvent: mockLogWorkflowEvent }
        throw new Error(`Unexpected DI token in test: ${token}`)
      },
    }
    mockEm = {
      findOne: jest.fn(async (entity: unknown) => (entity === UserTask ? task : null)),
      nativeUpdate: jest.fn<() => Promise<number>>().mockResolvedValue(1),
    } as unknown as jest.Mocked<EntityManager>
  })

  test('closes an open task and audits why', async () => {
    const outcome = await closeAgentDispositionTask(mockEm, mockContainer as never, options)

    expect(outcome).toBe('closed')
    expect(mockEm.nativeUpdate).toHaveBeenCalledWith(
      UserTask,
      expect.objectContaining({ id: taskId, status: { $in: ['PENDING', 'IN_PROGRESS'] } }),
      expect.objectContaining({ status: 'COMPLETED', completedBy: 'user-1' }),
    )
    expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({
        eventType: 'USER_TASK_COMPLETED',
        eventData: expect.objectContaining({ closedBy: 'agent_disposition', disposition: 'approved' }),
      }),
    )
  })

  test('never resolves DI services that could advance the run', async () => {
    // The container in this test throws on any token but `eventLogger`, so a
    // future edit that reached for `workflowExecutor` or `transitionHandler`
    // here would fail loudly rather than silently double-advancing the step.
    await expect(
      closeAgentDispositionTask(mockEm, mockContainer as never, options),
    ).resolves.toBe('closed')
  })

  test('a task somebody already completed is a no-op', async () => {
    ;(mockEm.nativeUpdate as jest.Mock).mockResolvedValue(0 as never)

    expect(await closeAgentDispositionTask(mockEm, mockContainer as never, options)).toBe('noop')
    expect(mockLogWorkflowEvent).not.toHaveBeenCalled()
  })

  test('a task that is not there is a no-op', async () => {
    task = null

    expect(await closeAgentDispositionTask(mockEm, mockContainer as never, options)).toBe('noop')
    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
  })

  test('the lookup is tenant- and organization-scoped', async () => {
    await closeAgentDispositionTask(mockEm, mockContainer as never, options)

    expect(mockEm.findOne).toHaveBeenCalledWith(
      UserTask,
      expect.objectContaining({ id: taskId, tenantId, organizationId }),
    )
  })
})
