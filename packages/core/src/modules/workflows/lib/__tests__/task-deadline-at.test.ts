import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import * as stepHandler from '../step-handler'
import { interpolateVariables } from '../activity-executor'
import { parseAbsoluteDeadline } from '../duration'
import { resolveTaskDeadline, resolveTaskDeadlineDuration } from '../task-resolution'
import { computeTaskSlaSchedule, scheduleUserTaskSla } from '../task-sla'
import { taskDeadlineSchema, workflowStepSchema } from '../../data/validators'
import { agentReviewConfigSchema } from '../../data/activity-config-schemas'
import type { WorkflowDefinition, WorkflowInstance } from '../../data/entities'

/**
 * Issue #7181 — an ABSOLUTE user-task deadline (`deadline.at`), interpolated
 * from the run context, as the alternative to a duration anchored to creation.
 */

jest.mock('../task-sla', () => {
  const actual = jest.requireActual('../task-sla') as Record<string, unknown>
  return { ...actual, scheduleUserTaskSla: jest.fn(async () => []) }
})

const scheduleMock = scheduleUserTaskSla as jest.MockedFunction<typeof scheduleUserTaskSla>

describe('parseAbsoluteDeadline', () => {
  test('an ISO date means the end of that day in UTC', () => {
    expect(parseAbsoluteDeadline('2026-10-20')?.toISOString()).toBe('2026-10-20T23:59:59.999Z')
  })

  test('an ISO datetime with Z or an offset is taken as written', () => {
    expect(parseAbsoluteDeadline('2026-10-20T15:00:00Z')?.toISOString()).toBe('2026-10-20T15:00:00.000Z')
    expect(parseAbsoluteDeadline('2026-10-20T15:00+02:00')?.toISOString()).toBe('2026-10-20T13:00:00.000Z')
    expect(parseAbsoluteDeadline('2026-10-20T15:00:30.250-0100')?.toISOString()).toBe('2026-10-20T16:00:30.250Z')
  })

  test('a Date instance is accepted as-is', () => {
    const instant = new Date('2026-10-20T15:00:00Z')
    expect(parseAbsoluteDeadline(instant)).toBe(instant)
  })

  test('anything that is not an unambiguous instant is refused', () => {
    expect(parseAbsoluteDeadline('2026-10-20T15:00:00')).toBeNull()
    expect(parseAbsoluteDeadline('2026-02-30')).toBeNull()
    expect(parseAbsoluteDeadline('2026-13-01T00:00Z')).toBeNull()
    expect(parseAbsoluteDeadline('2026-10-20T24:00Z')).toBeNull()
    expect(parseAbsoluteDeadline('Oct 20 2026')).toBeNull()
    expect(parseAbsoluteDeadline('{{context.dueDate}}')).toBeNull()
    expect(parseAbsoluteDeadline('')).toBeNull()
    expect(parseAbsoluteDeadline(undefined)).toBeNull()
    expect(parseAbsoluteDeadline(1792501200000)).toBeNull()
    expect(parseAbsoluteDeadline(new Date('nope'))).toBeNull()
  })
})

describe('taskDeadlineSchema', () => {
  test('accepts a duration, a literal instant or a template', () => {
    expect(taskDeadlineSchema.safeParse({ duration: 'P3D' }).success).toBe(true)
    expect(taskDeadlineSchema.safeParse({ at: '2026-10-20' }).success).toBe(true)
    expect(taskDeadlineSchema.safeParse({ at: '2026-10-20T15:00:00Z' }).success).toBe(true)
    expect(taskDeadlineSchema.safeParse({ at: '{{context.dueDate}}' }).success).toBe(true)
  })

  test('refuses both forms at once, neither form, and an unparseable literal', () => {
    const both = taskDeadlineSchema.safeParse({ duration: 'P3D', at: '{{context.dueDate}}' })
    expect(both.success).toBe(false)
    expect(both.error?.issues[0]?.path).toEqual(['at'])

    expect(taskDeadlineSchema.safeParse({}).success).toBe(false)
    expect(taskDeadlineSchema.safeParse({ at: 'next tuesday' }).success).toBe(false)
    expect(taskDeadlineSchema.safeParse({ at: '2026-10-20T15:00:00' }).success).toBe(false)
  })

  test('a step declaring both forms fails save-time validation', () => {
    const result = workflowStepSchema.safeParse({
      stepId: 'review',
      stepName: 'Review',
      stepType: 'USER_TASK',
      userTaskConfig: { deadline: { duration: 'P3D', at: '{{context.dueDate}}' } },
    })
    expect(result.success).toBe(false)
  })

  test('the agent disposition review keeps a duration-only deadline', () => {
    expect(agentReviewConfigSchema.safeParse({ deadline: { duration: 'PT4H' } }).success).toBe(true)
    expect(agentReviewConfigSchema.safeParse({ deadline: { at: '2026-10-20' } }).success).toBe(false)
  })
})

describe('resolveTaskDeadline', () => {
  const interpolate = (value: unknown) =>
    interpolateVariables(value, { dueDate: '2026-10-20', dueAt: '2026-10-20T09:30:00+02:00' })

  test('interpolates and parses deadline.at against the run context', () => {
    expect(resolveTaskDeadline({ deadline: { at: '{{context.dueDate}}' } }, interpolate)).toEqual({
      kind: 'at',
      authored: '{{context.dueDate}}',
      resolved: '2026-10-20',
      dueDate: new Date('2026-10-20T23:59:59.999Z'),
    })
    const datetime = resolveTaskDeadline({ deadline: { at: '{{context.dueAt}}' } }, interpolate)
    expect(datetime?.kind === 'at' && datetime.dueDate?.toISOString()).toBe('2026-10-20T07:30:00.000Z')
  })

  test('an unresolved template yields no due date, for the caller to fail on', () => {
    const missing = resolveTaskDeadline({ deadline: { at: '{{context.notThere}}' } }, interpolate)
    expect(missing).toMatchObject({ kind: 'at', dueDate: null })
  })

  test('deadline.at supersedes slaDuration; durations behave as before', () => {
    const config = { deadline: { at: '{{context.dueDate}}' }, slaDuration: 'P30D' }
    expect(resolveTaskDeadline(config, interpolate)?.kind).toBe('at')
    expect(resolveTaskDeadlineDuration(config)).toBeNull()

    expect(resolveTaskDeadline({ deadline: { duration: 'PT4H' }, slaDuration: 'P1D' }, interpolate)).toEqual({
      kind: 'duration',
      duration: 'PT4H',
    })
    expect(resolveTaskDeadline({ slaDuration: 'P1D' }, interpolate)).toEqual({ kind: 'duration', duration: 'P1D' })
    expect(resolveTaskDeadline({}, interpolate)).toBeNull()
  })
})

describe('reminders and breach are scheduled against the absolute deadline', () => {
  test('the breach fires at the instant and reminders count back from it', () => {
    const now = new Date('2026-10-18T12:00:00Z')
    const dueDate = parseAbsoluteDeadline('2026-10-20T12:00:00Z')

    const schedule = computeTaskSlaSchedule({ dueDate, reminders: [{ offset: 'P1D' }], now })

    expect(schedule.entries).toEqual([
      { phase: 'reminder', fireAt: '2026-10-19T12:00:00.000Z', delayMs: 24 * 3_600_000 },
      { phase: 'breach', fireAt: '2026-10-20T12:00:00.000Z', delayMs: 48 * 3_600_000 },
    ])
  })

  test('an instant already in the past breaches immediately and drops its reminders', () => {
    const now = new Date('2026-10-21T00:00:00Z')
    const schedule = computeTaskSlaSchedule({
      dueDate: parseAbsoluteDeadline('2026-10-20'),
      reminders: [{ offset: 'P1D' }],
      now,
    })
    expect(schedule.entries).toEqual([{ phase: 'breach', fireAt: '2026-10-20T23:59:59.999Z', delayMs: 0 }])
  })
})

describe('USER_TASK creation with deadline.at', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001'
  const organizationId = '00000000-0000-4000-8000-000000000002'
  const definitionId = '00000000-0000-4000-8000-000000000003'
  const instanceId = '00000000-0000-4000-8000-000000000004'

  beforeEach(() => {
    scheduleMock.mockClear()
  })

  async function runUserTask(userTaskConfig: Record<string, unknown>, workflowContext: Record<string, unknown>) {
    const mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      persist: jest.fn(function persist(this: unknown) { return this }),
      flush: jest.fn(),
      nativeDelete: jest.fn(),
    } as any

    const step = workflowStepSchema.parse({
      stepId: 'sign-deed',
      stepName: 'Sign the deed',
      stepType: 'USER_TASK',
      userTaskConfig: { assignedTo: 'clerk@example.com', ...userTaskConfig },
    })
    const definition: Partial<WorkflowDefinition> = {
      id: definitionId,
      workflowId: 'deeds',
      workflowName: 'Deeds',
      version: 1,
      enabled: true,
      definition: { steps: [step], transitions: [] } as any,
      tenantId,
      organizationId,
    }
    const instance: Partial<WorkflowInstance> = {
      id: instanceId,
      definitionId,
      workflowId: 'deeds',
      version: 1,
      status: 'RUNNING',
      currentStepId: step.stepId,
      context: workflowContext,
      tenantId,
      organizationId,
      startedAt: new Date(),
    }

    mockEm.findOne.mockResolvedValue(definition as WorkflowDefinition)
    mockEm.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({
      id: 'created-1',
      ...payload,
    }))

    const result = await stepHandler.executeStep(mockEm, instance as WorkflowInstance, step.stepId, {
      workflowContext,
    })
    const calls = (mockEm.create as jest.Mock).mock.calls as Array<[unknown, Record<string, any>]>
    const task = calls.find(([, payload]) => 'taskName' in payload)?.[1]
    return { result, task }
  }

  test('the task is due at the interpolated instant and SLA jobs are scheduled against it', async () => {
    const { result, task } = await runUserTask(
      { deadline: { at: '{{context.dueAt}}' }, reminders: [{ offset: 'P1D' }] },
      { dueAt: '2099-10-20T12:00:00Z' }
    )

    expect(result.status).toBe('WAITING')
    expect(task?.dueDate).toEqual(new Date('2099-10-20T12:00:00Z'))
    expect(scheduleMock).toHaveBeenCalledTimes(1)
    expect(scheduleMock.mock.calls[0][0]).toMatchObject({
      dueDate: new Date('2099-10-20T12:00:00Z'),
      reminders: [{ offset: 'P1D' }],
    })
  })

  test('an unresolved context value fails the step closed with a clear error and raises no task', async () => {
    const { result, task } = await runUserTask({ deadline: { at: '{{context.dueAt}}' } }, {})

    expect(result.status).toBe('FAILED')
    expect(result.error).toContain('{{context.dueAt}}')
    expect(result.error).toContain('ISO date')
    expect(task).toBeUndefined()
    expect(scheduleMock).not.toHaveBeenCalled()
  })

  test('an unparseable context value fails the step closed', async () => {
    const { result } = await runUserTask({ deadline: { at: '{{context.dueAt}}' } }, { dueAt: 'soon' })

    expect(result.status).toBe('FAILED')
    expect(result.error).toContain('resolved to "soon"')
  })

  test('regression: a duration deadline still anchors to task creation', async () => {
    const before = Date.now()
    const { result, task } = await runUserTask({ slaDuration: 'PT4H' }, {})

    expect(result.status).toBe('WAITING')
    const offsetMs = (task?.dueDate as Date).getTime() - before
    expect(offsetMs).toBeGreaterThanOrEqual(4 * 3_600_000)
    expect(offsetMs).toBeLessThan(4 * 3_600_000 + 60_000)
    expect(scheduleMock.mock.calls[0][0].dueDate).toBe(task?.dueDate)
  })
})
