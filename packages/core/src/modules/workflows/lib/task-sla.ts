/**
 * Task SLA scheduler — reminders and deadline breach for USER_TASK steps.
 *
 * `dueDate` has been display-only until now: nothing ever read it back, and the
 * authored `escalationRules` were dead config. This module makes the deadline
 * real, and it does so on the queue rather than with a poller — reusing the
 * Phase-3a absolute-deadline backstop the WAIT_FOR_CONDITION step already
 * relies on:
 *
 *   - every job is enqueued ONCE, at task creation, with a delay;
 *   - `deadlineAt` is ABSOLUTE and rides on the payload, so a queue running
 *     behind cannot silently extend the deadline the author configured;
 *   - the handler is IDEMPOTENT — a completed, cancelled or already-breached
 *     task makes the job a no-op, and the breach is claimed with a conditional
 *     UPDATE so at-least-once delivery still fires it exactly once.
 *
 * `computeTaskSlaSchedule` is PURE (no ORM, DI or registry imports) so the
 * scheduling arithmetic is unit-testable without a workflow.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { UserTask, WorkflowInstance } from '../data/entities'
import type { TaskReminder } from '../data/validators'
import { parseDuration } from './duration'
import { emitWorkflowsEvent } from '../events'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export type TaskSlaPhase = 'reminder' | 'breach'

export interface TaskSlaScheduleEntry {
  phase: TaskSlaPhase
  /** Absolute time this job should run. */
  fireAt: string
  /** Delay from `now`; never negative. */
  delayMs: number
}

export interface TaskSlaSchedule {
  entries: TaskSlaScheduleEntry[]
  /** Reminder offsets that could not be parsed, so the caller can log them. */
  invalidOffsets: string[]
}

/** Statuses a task is still workable in — anything else makes an SLA job moot. */
const OPEN_TASK_STATUSES = ['PENDING', 'IN_PROGRESS'] as const

/**
 * Resolve the jobs to enqueue for one task.
 *
 * A task with no deadline schedules NOTHING — reminders without a deadline have
 * nothing to count back from, so they are silently irrelevant rather than an
 * error. A reminder whose moment has already passed is dropped: firing it at
 * creation time would be noise, not a nudge. A reminder offset at or beyond the
 * whole deadline is likewise dropped — the breach job already speaks for that
 * moment.
 */
export function computeTaskSlaSchedule(options: {
  dueDate: Date | null | undefined
  reminders?: TaskReminder[] | null
  now?: Date
}): TaskSlaSchedule {
  const { dueDate } = options
  if (!dueDate || Number.isNaN(dueDate.getTime())) return { entries: [], invalidOffsets: [] }

  const nowMs = (options.now ?? new Date()).getTime()
  const deadlineMs = dueDate.getTime()
  const entries: TaskSlaScheduleEntry[] = []
  const invalidOffsets: string[] = []

  for (const reminder of options.reminders ?? []) {
    const offset = reminder?.offset
    if (typeof offset !== 'string' || !offset.length) continue

    let offsetMs: number
    try {
      offsetMs = parseDuration(offset)
    } catch {
      invalidOffsets.push(offset)
      continue
    }

    if (offsetMs <= 0) continue
    const remindAtMs = deadlineMs - offsetMs
    if (remindAtMs <= nowMs || remindAtMs >= deadlineMs) continue

    entries.push({
      phase: 'reminder',
      fireAt: new Date(remindAtMs).toISOString(),
      delayMs: remindAtMs - nowMs,
    })
  }

  entries.push({
    phase: 'breach',
    fireAt: dueDate.toISOString(),
    delayMs: Math.max(0, deadlineMs - nowMs),
  })

  entries.sort((left, right) => left.delayMs - right.delayMs)

  return { entries, invalidOffsets }
}

export interface ScheduleUserTaskSlaOptions {
  workflowInstanceId: string
  stepInstanceId: string
  branchInstanceId?: string | null
  userTaskId: string
  dueDate: Date | null | undefined
  reminders?: TaskReminder[] | null
  tenantId: string
  organizationId: string
  userId?: string
  now?: Date
}

/**
 * Enqueue every SLA job a freshly created task needs.
 *
 * Best-effort by contract: a queue failure must never break the workflow step
 * that created the task, exactly as the assignment event's emission does not.
 */
export async function scheduleUserTaskSla(
  options: ScheduleUserTaskSlaOptions
): Promise<string[]> {
  const schedule = computeTaskSlaSchedule({
    dueDate: options.dueDate,
    reminders: options.reminders,
    now: options.now,
  })

  if (schedule.invalidOffsets.length) {
    logger.warn('Task reminder offsets skipped because they are not valid durations', {
      component: 'task-sla',
      taskId: options.userTaskId,
      invalidOffsets: schedule.invalidOffsets,
    })
  }

  if (schedule.entries.length === 0) return []

  const deadlineAt = options.dueDate ? options.dueDate.toISOString() : null
  if (!deadlineAt) return []

  const jobIds: string[] = []
  try {
    const { enqueueTaskSlaJob } = await import('./activity-executor')
    for (const entry of schedule.entries) {
      const jobId = await enqueueTaskSlaJob({
        workflowInstanceId: options.workflowInstanceId,
        stepInstanceId: options.stepInstanceId,
        branchInstanceId: options.branchInstanceId ?? null,
        userTaskId: options.userTaskId,
        phase: entry.phase,
        deadlineAt,
        fireAt: entry.fireAt,
        delayMs: entry.delayMs,
        tenantId: options.tenantId,
        organizationId: options.organizationId,
        userId: options.userId,
      })
      jobIds.push(jobId)
    }
  } catch (error) {
    logger.error('Failed to schedule task SLA jobs', {
      component: 'task-sla',
      taskId: options.userTaskId,
      err: error,
    })
  }

  return jobIds
}

export type TaskSlaOutcome = 'noop' | 'reminded' | 'breached'

export interface RunTaskSlaJobOptions {
  userTaskId: string
  stepInstanceId: string
  workflowInstanceId: string
  branchInstanceId?: string | null
  phase: TaskSlaPhase
  deadlineAt: string
  tenantId: string
  organizationId: string
  userId?: string
}

/**
 * Run one SLA job.
 *
 * Every early return is a deliberate no-op rather than an error: the queue
 * retries, and a task that was completed in the meantime is the ordinary case,
 * not a failure.
 */
export async function runTaskSlaJob(
  em: EntityManager,
  container: AwilixContainer,
  options: RunTaskSlaJobOptions
): Promise<TaskSlaOutcome> {
  const { tenantId, organizationId } = options

  const task = await em.findOne(UserTask, {
    id: options.userTaskId,
    tenantId,
    organizationId,
  })

  if (!task) return 'noop'
  if (!OPEN_TASK_STATUSES.includes(task.status as (typeof OPEN_TASK_STATUSES)[number])) return 'noop'

  const deadlineMs = Date.parse(options.deadlineAt)
  if (Number.isNaN(deadlineMs)) return 'noop'

  if (options.phase === 'reminder') {
    // A reminder that arrives after the deadline has nothing left to warn
    // about, and one for an already-breached task is strictly noise.
    if (task.escalatedAt) return 'noop'
    if (Date.now() >= deadlineMs) return 'noop'

    await logTaskSlaEvent(em, container, options, 'USER_TASK_REMINDER_DUE', {
      taskId: task.id,
      taskName: task.taskName,
      dueDate: options.deadlineAt,
    })

    await emitTaskSlaEvent(em, 'workflows.task.reminder_due', task, options)
    return 'reminded'
  }

  // Claim the breach with a conditional UPDATE rather than a read-then-write:
  // the queue delivers at least once, and two deliveries reading `escalated_at
  // IS NULL` would both fire. The loser updates zero rows and no-ops.
  const now = new Date()
  const claimed = await em.nativeUpdate(
    UserTask,
    {
      id: task.id,
      tenantId,
      organizationId,
      status: { $in: [...OPEN_TASK_STATUSES] },
      escalatedAt: null,
    },
    { escalatedAt: now, updatedAt: now }
  )

  if (claimed === 0) return 'noop'

  task.escalatedAt = now
  task.updatedAt = now

  await logTaskSlaEvent(em, container, options, 'USER_TASK_DEADLINE_BREACHED', {
    taskId: task.id,
    taskName: task.taskName,
    dueDate: options.deadlineAt,
    breachedAt: now.toISOString(),
  })

  await emitTaskSlaEvent(em, 'workflows.task.deadline_breached', task, options)

  return 'breached'
}

async function logTaskSlaEvent(
  em: EntityManager,
  container: AwilixContainer,
  options: RunTaskSlaJobOptions,
  eventType: string,
  eventData: Record<string, unknown>
): Promise<void> {
  try {
    const eventLogger = container.resolve<{
      logWorkflowEvent: (
        em: EntityManager,
        event: Record<string, unknown>
      ) => Promise<unknown>
    }>('eventLogger')

    await eventLogger.logWorkflowEvent(em, {
      workflowInstanceId: options.workflowInstanceId,
      stepInstanceId: options.stepInstanceId,
      ...(options.branchInstanceId ? { branchInstanceId: options.branchInstanceId } : {}),
      eventType,
      eventData,
      userId: options.userId,
      tenantId: options.tenantId,
      organizationId: options.organizationId,
    })
  } catch (error) {
    logger.error('Failed to log task SLA workflow event', {
      component: 'task-sla',
      taskId: options.userTaskId,
      eventType,
      err: error,
    })
  }
}

async function emitTaskSlaEvent(
  em: EntityManager,
  eventId: 'workflows.task.reminder_due' | 'workflows.task.deadline_breached',
  task: UserTask,
  options: RunTaskSlaJobOptions
): Promise<void> {
  try {
    const instance = await em.findOne(WorkflowInstance, {
      id: options.workflowInstanceId,
      tenantId: options.tenantId,
      organizationId: options.organizationId,
    })

    await emitWorkflowsEvent(
      eventId,
      {
        taskId: task.id,
        taskName: task.taskName,
        workflowInstanceId: options.workflowInstanceId,
        workflowId: instance?.workflowId ?? null,
        workflowName: instance?.workflowId ?? '',
        assignedUserId: task.claimedBy ?? task.assignedTo ?? null,
        assignedToRoles: task.assignedToRoles ?? null,
        dueDate: options.deadlineAt,
        entityBindings: task.entityBindings ?? null,
        tenantId: options.tenantId,
        organizationId: options.organizationId,
      },
      { persistent: true }
    )
  } catch (error) {
    logger.error('Failed to emit task SLA event', {
      component: 'task-sla',
      taskId: task.id,
      eventId,
      err: error,
    })
  }
}
