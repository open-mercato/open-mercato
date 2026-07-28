/**
 * Task SLA scheduler (spec §6.1 §4).
 *
 * Covers the four properties the deadline machinery has to hold:
 *  - jobs are scheduled at task creation with the deadline ABSOLUTE on the
 *    payload, so a slow queue cannot extend it;
 *  - reminders fire at their offset before the deadline;
 *  - the breach fires exactly once, even under at-least-once delivery;
 *  - a completed/cancelled task, and a task with no deadline, cost nothing.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import {
  computeTaskSlaSchedule,
  runTaskSlaJob,
  scheduleUserTaskSla,
} from '../task-sla'
import { enqueueTaskSlaJob } from '../activity-executor'
import { emitWorkflowsEvent } from '../../events'

jest.mock('../activity-executor', () => {
  const actual = jest.requireActual('../activity-executor') as Record<string, unknown>
  return { ...actual, enqueueTaskSlaJob: jest.fn() }
})

jest.mock('../../events', () => {
  const actual = jest.requireActual('../../events') as Record<string, unknown>
  return { ...actual, emitWorkflowsEvent: jest.fn() }
})

const mockEnqueue = enqueueTaskSlaJob as jest.MockedFunction<typeof enqueueTaskSlaJob>
const mockEmit = emitWorkflowsEvent as jest.MockedFunction<typeof emitWorkflowsEvent>

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const instanceId = '00000000-0000-4000-8000-000000000003'
const stepInstanceId = '00000000-0000-4000-8000-000000000004'
const taskId = '00000000-0000-4000-8000-000000000005'

describe('computeTaskSlaSchedule', () => {
  const now = new Date('2026-07-28T10:00:00.000Z')

  test('schedules nothing when the task has no deadline', () => {
    const schedule = computeTaskSlaSchedule({
      dueDate: null,
      reminders: [{ offset: 'PT1H' }],
      now,
    })

    expect(schedule.entries).toEqual([])
    expect(schedule.invalidOffsets).toEqual([])
  })

  test('schedules the breach at the deadline itself', () => {
    const dueDate = new Date('2026-07-28T14:00:00.000Z')
    const schedule = computeTaskSlaSchedule({ dueDate, now })

    expect(schedule.entries).toHaveLength(1)
    expect(schedule.entries[0]).toEqual({
      phase: 'breach',
      fireAt: dueDate.toISOString(),
      delayMs: 4 * 60 * 60 * 1000,
    })
  })

  test('schedules each reminder at its offset before the deadline', () => {
    const dueDate = new Date('2026-07-28T14:00:00.000Z')
    const schedule = computeTaskSlaSchedule({
      dueDate,
      reminders: [{ offset: 'PT1H' }, { offset: 'PT30M' }],
      now,
    })

    expect(schedule.entries.map((entry) => entry.phase)).toEqual([
      'reminder',
      'reminder',
      'breach',
    ])
    expect(schedule.entries[0].fireAt).toBe('2026-07-28T13:00:00.000Z')
    expect(schedule.entries[1].fireAt).toBe('2026-07-28T13:30:00.000Z')
    expect(schedule.entries[2].fireAt).toBe(dueDate.toISOString())
  })

  test('drops reminders whose moment already passed and offsets past the deadline', () => {
    const dueDate = new Date('2026-07-28T11:00:00.000Z')
    const schedule = computeTaskSlaSchedule({
      dueDate,
      // 3h before an 11:00 deadline is 08:00 — already past at 10:00.
      // 5h is longer than the whole window, so it is the breach's own moment.
      reminders: [{ offset: 'PT3H' }, { offset: 'PT5H' }, { offset: 'PT30M' }],
      now,
    })

    expect(schedule.entries.map((entry) => entry.phase)).toEqual(['reminder', 'breach'])
    expect(schedule.entries[0].fireAt).toBe('2026-07-28T10:30:00.000Z')
  })

  test('reports unparseable reminder offsets instead of throwing', () => {
    const schedule = computeTaskSlaSchedule({
      dueDate: new Date('2026-07-28T14:00:00.000Z'),
      reminders: [{ offset: 'not-a-duration' }, { offset: 'PT1H' }],
      now,
    })

    expect(schedule.invalidOffsets).toEqual(['not-a-duration'])
    expect(schedule.entries.map((entry) => entry.phase)).toEqual(['reminder', 'breach'])
  })

  test('a deadline already in the past breaches immediately, never negatively', () => {
    const schedule = computeTaskSlaSchedule({
      dueDate: new Date('2026-07-28T09:00:00.000Z'),
      now,
    })

    expect(schedule.entries).toHaveLength(1)
    expect(schedule.entries[0].delayMs).toBe(0)
  })
})

describe('scheduleUserTaskSla', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEnqueue.mockResolvedValue('job-1')
  })

  const baseOptions = {
    workflowInstanceId: instanceId,
    stepInstanceId,
    userTaskId: taskId,
    tenantId,
    organizationId,
    now: new Date('2026-07-28T10:00:00.000Z'),
  }

  test('enqueues one job per reminder plus one for the deadline, all carrying the absolute deadline', async () => {
    const dueDate = new Date('2026-07-28T14:00:00.000Z')

    await scheduleUserTaskSla({
      ...baseOptions,
      dueDate,
      reminders: [{ offset: 'PT1H' }],
    })

    expect(mockEnqueue).toHaveBeenCalledTimes(2)
    const [reminderJob] = mockEnqueue.mock.calls[0]
    const [breachJob] = mockEnqueue.mock.calls[1]

    expect(reminderJob.phase).toBe('reminder')
    expect(reminderJob.deadlineAt).toBe(dueDate.toISOString())
    expect(reminderJob.fireAt).toBe('2026-07-28T13:00:00.000Z')
    expect(reminderJob.delayMs).toBe(3 * 60 * 60 * 1000)

    expect(breachJob.phase).toBe('breach')
    // The deadline is absolute on the payload — never a duration the worker
    // would re-anchor to whenever it happens to run.
    expect(breachJob.deadlineAt).toBe(dueDate.toISOString())
    expect(breachJob.delayMs).toBe(4 * 60 * 60 * 1000)
    expect(breachJob.userTaskId).toBe(taskId)
    expect(breachJob.tenantId).toBe(tenantId)
    expect(breachJob.organizationId).toBe(organizationId)
  })

  test('a task with no deadline schedules nothing', async () => {
    await scheduleUserTaskSla({ ...baseOptions, dueDate: null, reminders: [{ offset: 'PT1H' }] })

    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  test('a queue failure never propagates into the step that created the task', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('queue down'))

    await expect(
      scheduleUserTaskSla({ ...baseOptions, dueDate: new Date('2026-07-28T14:00:00.000Z') })
    ).resolves.toEqual([])
  })
})

describe('runTaskSlaJob', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockLogWorkflowEvent: jest.Mock
  let mockContainer: { resolve: (token: string) => unknown }

  const makeTask = (overrides: Record<string, unknown> = {}) => ({
    id: taskId,
    taskName: 'Approve the order',
    status: 'PENDING',
    assignedTo: 'user-1',
    assignedToRoles: null,
    claimedBy: null,
    escalatedAt: null,
    entityBindings: null,
    updatedAt: new Date(),
    ...overrides,
  })

  const jobOptions = {
    userTaskId: taskId,
    stepInstanceId,
    workflowInstanceId: instanceId,
    phase: 'breach' as const,
    deadlineAt: '2026-07-28T14:00:00.000Z',
    tenantId,
    organizationId,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockLogWorkflowEvent = jest.fn<() => Promise<unknown>>().mockResolvedValue({})
    mockContainer = {
      resolve: (token: string) => {
        if (token === 'eventLogger') return { logWorkflowEvent: mockLogWorkflowEvent }
        throw new Error(`Unexpected DI token in test: ${token}`)
      },
    }
    mockEm = {
      findOne: jest.fn(),
      nativeUpdate: jest.fn(),
      flush: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>
    mockEmit.mockResolvedValue(undefined as never)
  })

  test('breach fires once: it claims the row and emits the declared event', async () => {
    const task = makeTask()
    ;(mockEm.findOne as jest.Mock).mockResolvedValue(task as never)
    ;(mockEm.nativeUpdate as jest.Mock).mockResolvedValue(1 as never)

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, jobOptions)

    expect(outcome).toBe('breached')
    expect(task.escalatedAt).toBeInstanceOf(Date)
    expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({ eventType: 'USER_TASK_DEADLINE_BREACHED' })
    )
    expect(mockEmit).toHaveBeenCalledWith(
      'workflows.task.deadline_breached',
      expect.objectContaining({ taskId, dueDate: jobOptions.deadlineAt }),
      { persistent: true }
    )
  })

  test('a redelivered breach job is a no-op: the conditional claim matches zero rows', async () => {
    ;(mockEm.findOne as jest.Mock).mockResolvedValue(makeTask() as never)
    ;(mockEm.nativeUpdate as jest.Mock).mockResolvedValue(0 as never)

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, jobOptions)

    expect(outcome).toBe('noop')
    expect(mockEmit).not.toHaveBeenCalled()
  })

  test('a completed task makes the job a no-op', async () => {
    ;(mockEm.findOne as jest.Mock).mockResolvedValue(makeTask({ status: 'COMPLETED' }) as never)

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, jobOptions)

    expect(outcome).toBe('noop')
    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  test('a cancelled task makes the job a no-op', async () => {
    ;(mockEm.findOne as jest.Mock).mockResolvedValue(makeTask({ status: 'CANCELLED' }) as never)

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, jobOptions)

    expect(outcome).toBe('noop')
    expect(mockEmit).not.toHaveBeenCalled()
  })

  test('a task from another tenant is never found, so nothing fires', async () => {
    ;(mockEm.findOne as jest.Mock).mockResolvedValue(null as never)

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, jobOptions)

    expect(outcome).toBe('noop')
    expect(mockEm.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: taskId, tenantId, organizationId })
    )
  })

  test('a reminder before the deadline emits the reminder event', async () => {
    ;(mockEm.findOne as jest.Mock).mockResolvedValue(makeTask() as never)
    const deadlineAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, {
      ...jobOptions,
      phase: 'reminder',
      deadlineAt,
    })

    expect(outcome).toBe('reminded')
    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
    expect(mockEmit).toHaveBeenCalledWith(
      'workflows.task.reminder_due',
      expect.objectContaining({ taskId }),
      { persistent: true }
    )
  })

  test('a reminder that arrives after the deadline is a no-op', async () => {
    ;(mockEm.findOne as jest.Mock).mockResolvedValue(makeTask() as never)

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, {
      ...jobOptions,
      phase: 'reminder',
      deadlineAt: new Date(Date.now() - 1000).toISOString(),
    })

    expect(outcome).toBe('noop')
    expect(mockEmit).not.toHaveBeenCalled()
  })

  test('a reminder for an already-breached task is a no-op', async () => {
    ;(mockEm.findOne as jest.Mock).mockResolvedValue(
      makeTask({ escalatedAt: new Date() }) as never
    )

    const outcome = await runTaskSlaJob(mockEm, mockContainer as never, {
      ...jobOptions,
      phase: 'reminder',
      deadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })

    expect(outcome).toBe('noop')
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
