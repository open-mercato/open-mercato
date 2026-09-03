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
import { StepInstance, UserTask, WorkflowInstance } from '../data/entities'
import type { TaskOnBreach, TaskReminder } from '../data/validators'
import { parseDuration } from './duration'
import { resolveTaskBreachHandling, type TaskBreachHandling } from './breach-routing'
import {
  findAgentReviewConfig,
  resolveAgentReviewBreachHandling,
  INVOKE_AGENT_ACTIVITY_TYPE,
  type AgentReviewBreachHandling,
  type AgentReviewStepLike,
} from './agent-review'
import { findDefinitionForInstance } from './find-definition'
import { emitWorkflowsEvent } from '../events'
import type * as stepHandlerModule from './step-handler'
import type * as transitionHandlerModule from './transition-handler'
import type * as workflowExecutorModule from './workflow-executor'
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

  // WHICH path the breach took is part of the audit trail, not an implementation
  // detail: "the deadline passed" and "the deadline passed and the run was
  // routed away from this task" are different facts about the same instant.
  const handling = await applyBreachHandling(em, container, task, options, now)

  await logTaskSlaEvent(em, container, options, 'USER_TASK_DEADLINE_BREACHED', {
    taskId: task.id,
    taskName: task.taskName,
    dueDate: options.deadlineAt,
    breachedAt: now.toISOString(),
    onBreach: handling.outcome,
    ...(handling.detail ?? {}),
  })

  await emitTaskSlaEvent(em, 'workflows.task.deadline_breached', task, options)

  // A reassignment only means anything once the new owner is told about it, and
  // the assignment event is the one path that already reaches both an individual
  // and a role queue.
  if (handling.outcome === 'reassigned') {
    await emitTaskSlaEvent(em, 'workflows.task.assigned', task, options)
  }

  if (handling.resumeInstance) {
    await resumeAfterBreachRoute(em, container, task, options, handling.resumeInstance)
  }

  return 'breached'
}

type BreachOutcome =
  | 'none'
  | 'notified'
  | 'reassigned'
  | 'routed'
  | 'route_skipped_branch'
  | 'attention'

interface AppliedBreachHandling {
  outcome: BreachOutcome
  detail?: Record<string, unknown>
  resumeInstance?: { stepId: string; toStepId: string; transitionId?: string }
}

type BreachResolution = TaskBreachHandling | AgentReviewBreachHandling

/**
 * A step whose breached task is an agent DISPOSITION task rather than an
 * authored USER_TASK. Recognised structurally from the compiled step (an
 * AUTOMATED step carrying an INVOKE_AGENT activity), which is the same shape
 * `graph-utils` round-trips the node from.
 */
function isInvokeAgentStepDef(step: AgentReviewStepLike | undefined): boolean {
  return (step?.activities ?? []).some(
    (activity) => activity?.activityType === INVOKE_AGENT_ACTIVITY_TYPE
  )
}

/**
 * Apply the resolver's answer to the task row. Routing itself is deferred to
 * `resumeAfterBreachRoute` so the workflow only advances after the breach has
 * been recorded and announced.
 *
 * Which resolver answers depends on WHAT the task is. An authored USER_TASK
 * keeps the full §6.1 vocabulary, including "follow a route". An agent
 * disposition task (§7.5) gets the escalate-only one: notify, reassign, or mark
 * the run for attention. It can reach neither a verdict nor a route, because
 * both would resolve a pending proposal without a human — routing the run past
 * a proposal nobody answered silently drops the mutation the agent proposed,
 * which is a rejection in everything but name. A hand-authored `kind:'slaBreach'`
 * transition on an agent step therefore cannot fire either: the branch below is
 * taken from the STEP's shape, not from the config the author supplied.
 */
async function applyBreachHandling(
  em: EntityManager,
  container: AwilixContainer,
  task: UserTask,
  options: RunTaskSlaJobOptions,
  now: Date
): Promise<AppliedBreachHandling> {
  let resolution: BreachResolution = { kind: 'none' }
  let stepId: string | null = null
  let instance: WorkflowInstance | null = null

  try {
    const stepInstance = await em.findOne(StepInstance, {
      id: options.stepInstanceId,
      tenantId: options.tenantId,
      organizationId: options.organizationId,
    })
    stepId = stepInstance?.stepId ?? null

    instance = await em.findOne(WorkflowInstance, {
      id: options.workflowInstanceId,
      tenantId: options.tenantId,
      organizationId: options.organizationId,
    })

    if (stepId && instance) {
      const definition = await findDefinitionForInstance(em, instance)
      const stepDef = (definition?.definition?.steps ?? []).find(
        (step: { stepId?: string }) => step.stepId === stepId
      ) as
        | ({ userTaskConfig?: { onBreach?: TaskOnBreach | null } } & AgentReviewStepLike)
        | undefined

      resolution = isInvokeAgentStepDef(stepDef)
        ? resolveAgentReviewBreachHandling(findAgentReviewConfig(stepDef)?.onBreach ?? null)
        : resolveTaskBreachHandling(
            definition?.definition ?? null,
            stepId,
            stepDef?.userTaskConfig?.onBreach ?? null
          )
    }
  } catch (error) {
    // A definition the engine can no longer read must not strand the breach:
    // the task is already marked escalated and the event still fires.
    logger.error('Failed to resolve breach handling; falling back to notify-only', {
      component: 'task-sla',
      taskId: task.id,
      err: error,
    })
    return { outcome: 'none' }
  }

  if (resolution.kind === 'notify') return { outcome: 'notified' }

  if (resolution.kind === 'attention') {
    if (!instance) return { outcome: 'none' }
    await markInstanceForAttention(em, instance, stepId, task, now)
    return { outcome: 'attention', detail: { stepId } }
  }

  if (resolution.kind === 'reassign') {
    task.assignedTo = resolution.assignedTo
    task.assignedToRoles = resolution.assignedToRoles
    task.claimedBy = null
    task.claimedAt = null
    task.status = 'PENDING'
    task.escalatedTo = resolution.assignedTo ?? resolution.assignedToRoles?.[0] ?? null
    task.reassignedAt = now
    task.reassignReason = 'sla_breach'
    task.updatedAt = now
    await em.flush()
    return {
      outcome: 'reassigned',
      detail: {
        reassignedTo: resolution.assignedTo,
        reassignedToRoles: resolution.assignedToRoles,
      },
    }
  }

  if (resolution.kind === 'route') {
    const toStepId = resolution.transition.toStepId
    if (!stepId || !toStepId) return { outcome: 'none' }

    // A branch-scoped task does NOT follow its breach route, for the same
    // reason a decision button does not select a route inside a branch
    // (`completeUserTask`): a branch advances through `resumeBranch` with its
    // own token, and overriding that is a parallel-execution change rather than
    // a task-surface one.
    if (options.branchInstanceId) {
      return { outcome: 'route_skipped_branch', detail: { transitionId: resolution.transition.transitionId } }
    }

    // The task is superseded by the route, not abandoned: `ESCALATED` is an
    // existing `UserTaskStatus`, so no state machine changes.
    task.status = 'ESCALATED'
    task.updatedAt = now
    await em.flush()

    return {
      outcome: 'routed',
      detail: { transitionId: resolution.transition.transitionId, toStepId },
      resumeInstance: { stepId, toStepId, transitionId: resolution.transition.transitionId },
    }
  }

  return { outcome: 'none' }
}

/**
 * Mark a run for triage without touching its state machine.
 *
 * The instance is ALREADY paused — an agent step parks on the proposal-ready
 * signal — so this writes only the engine-owned `metadata.attention` marker the
 * failure queue already uses (`GET /api/workflows/instances?attention=true`
 * lists it). Deliberately no status write, no `errorMessage`: the run is not
 * failing, it is waiting on a person who is late, and the proposal is still
 * pending for whoever picks it up.
 */
async function markInstanceForAttention(
  em: EntityManager,
  instance: WorkflowInstance,
  stepId: string | null,
  task: UserTask,
  now: Date
): Promise<void> {
  instance.metadata = {
    ...(instance.metadata || {}),
    attention: {
      reason: 'DISPOSITION_SLA_BREACH',
      ...(stepId ? { stepId } : {}),
      at: now.toISOString(),
    },
  }
  instance.updatedAt = now
  await em.flush()

  logger.warn('Agent disposition deadline passed; run marked for attention', {
    component: 'task-sla',
    taskId: task.id,
    workflowInstanceId: instance.id,
    stepId,
  })
}

/**
 * Follow the breach route: exit the task's step and drive the run onward,
 * mirroring how `fireTimer` resumes a run parked on a WAIT_FOR_TIMER step.
 *
 * Best-effort: a routing failure leaves the run exactly where it was, with the
 * breach already recorded, rather than throwing the queue job into a retry loop
 * that would re-announce a breach that has already fired.
 */
async function resumeAfterBreachRoute(
  em: EntityManager,
  container: AwilixContainer,
  task: UserTask,
  options: RunTaskSlaJobOptions,
  route: { stepId: string; toStepId: string; transitionId?: string }
): Promise<void> {
  try {
    const instance = await em.findOne(WorkflowInstance, {
      id: options.workflowInstanceId,
      tenantId: options.tenantId,
      organizationId: options.organizationId,
    })
    if (!instance) return

    const stepHandler = container.resolve<typeof stepHandlerModule>('stepHandler')
    const transitionHandler = container.resolve<typeof transitionHandlerModule>('transitionHandler')
    const workflowExecutor = container.resolve<typeof workflowExecutorModule>('workflowExecutor')

    const stepInstance = await em.findOne(StepInstance, {
      id: options.stepInstanceId,
      status: 'ACTIVE',
    })
    if (stepInstance) {
      await stepHandler.exitStep(em, stepInstance, {
        userTaskId: task.id,
        slaBreached: true,
      })
    }

    const transitionResult = await transitionHandler.executeTransition(
      em,
      container,
      instance,
      route.stepId,
      route.toStepId,
      {
        workflowContext: instance.context,
        userId: options.userId,
        transitionId: route.transitionId,
      },
    )

    if (!transitionResult.success) {
      logger.error('SLA-breach transition failed', {
        component: 'task-sla',
        taskId: task.id,
        err: transitionResult.error,
      })
      return
    }

    await workflowExecutor.executeWorkflow(em, container, instance.id, { userId: options.userId })
  } catch (error) {
    logger.error('Failed to follow the SLA-breach route', {
      component: 'task-sla',
      taskId: task.id,
      err: error,
    })
  }
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
  eventId: 'workflows.task.reminder_due' | 'workflows.task.deadline_breached' | 'workflows.task.assigned',
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
