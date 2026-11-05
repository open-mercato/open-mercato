/**
 * Workflows Module — the implicit agent-disposition task (spec §7.5).
 *
 * When an INVOKE_AGENT step's confidence gate routes to a human, the enterprise
 * `dispositionService` raises a workflows `USER_TASK` for that decision. Until
 * now it built that row itself, inline, with no assignee, no role queue, no
 * deadline, no audit event and no assignment event — which under the §6.4
 * visibility model produces a task that is visible only to administrative
 * oversight and ACTABLE BY NOBODY (`currentTaskOwnerId` is null, so
 * `ownsTheRow` is false for every principal), and which never reaches the
 * notification subscriber at all.
 *
 * The disposition task is supposed to be "a real Work Inbox task" (§7.5), so
 * the row is built HERE, by the module that owns the entity, the audit log, the
 * assignment event and the SLA scheduler — and the enterprise service passes
 * the authored Review descriptor in. `agent_orchestrator` stays an optional
 * peer in both directions: it reaches this module through a dynamic import
 * guarded by its own try/catch, exactly as `lib/disposition/resume.ts` reaches
 * `sendSignal`.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { StepInstance, UserTask, WorkflowInstance } from '../data/entities'
import { calculateDueDate } from './duration'
import { scheduleUserTaskSla } from './task-sla'
import { emitWorkflowsEvent } from '../events'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

/**
 * The already-resolved Review section: assignment interpolated against the run
 * context and the deadline still expressed as a DURATION, because a disposition
 * deadline is anchored to when the task is created — not to when the agent was
 * enqueued, which can be minutes earlier.
 */
export interface AgentDispositionReview {
  assignedTo?: string | null
  assignedToRoles?: string[] | null
  priority?: string | null
  deadlineDuration?: string | null
  reminders?: { offset: string }[] | null
}

export interface CreateAgentDispositionTaskOptions {
  workflowInstanceId: string
  stepId: string
  proposalId: string
  agentId: string
  proposalPayload: unknown
  confidence: number | null
  taskName: string
  description: string
  review?: AgentDispositionReview | null
  tenantId: string
  organizationId: string
  userId?: string
  now?: Date
}

export interface CreatedAgentDispositionTask {
  userTaskId: string
  stepInstanceId: string
  assignedTo: string | null
  assignedToRoles: string[] | null
  dueDate: Date | null
}

function resolveDueDate(
  duration: string | null | undefined,
  now: Date,
  proposalId: string,
): Date | null {
  if (typeof duration !== 'string' || !duration.length) return null
  try {
    return calculateDueDate(duration, now)
  } catch (error) {
    // An unparseable deadline must not cost the operator the task. A USER_TASK
    // step fails the step here; a disposition task cannot, because the agent has
    // already run and its proposal is already pending — losing the review task
    // would strand the proposal with nobody able to see it.
    logger.warn('Agent review deadline skipped because it is not a valid duration', {
      component: 'agent-disposition-task',
      proposalId,
      duration,
    })
    return null
  }
}

/**
 * Create the disposition task for a pending proposal.
 *
 * Returns the created task; throws only when the workflow instance the caller
 * named cannot be read, which is the caller's signal to fall back to its
 * synthetic id.
 */
export async function createAgentDispositionTask(
  em: EntityManager,
  container: AwilixContainer,
  options: CreateAgentDispositionTaskOptions,
): Promise<CreatedAgentDispositionTask> {
  const { tenantId, organizationId } = options
  const now = options.now ?? new Date()

  const instance = await em.findOne(WorkflowInstance, {
    id: options.workflowInstanceId,
    tenantId,
    organizationId,
  })
  if (!instance) {
    throw new Error(
      `[internal] workflow instance ${options.workflowInstanceId} not found for agent disposition task`,
    )
  }

  const stepInstance = await em.findOne(StepInstance, {
    workflowInstanceId: options.workflowInstanceId,
    stepId: options.stepId,
    status: 'ACTIVE',
    tenantId,
    organizationId,
  })

  const review = options.review ?? null
  const assignedTo = review?.assignedTo?.length ? review.assignedTo : null
  const assignedToRoles = review?.assignedToRoles?.length ? review.assignedToRoles : null
  const dueDate = resolveDueDate(review?.deadlineDuration, now, options.proposalId)

  const task = em.create(UserTask, {
    workflowInstanceId: options.workflowInstanceId,
    // The step instance is what the SLA scheduler, the run view and the §6.4
    // gate address. Falling back to the workflow instance id (as the inline
    // version did) writes a value that is not a step instance at all.
    stepInstanceId: stepInstance?.id ?? options.workflowInstanceId,
    branchInstanceId: stepInstance?.branchInstanceId ?? null,
    taskName: options.taskName,
    description: options.description,
    status: 'PENDING',
    formSchema: {
      proposalId: options.proposalId,
      payload: options.proposalPayload,
      confidence: options.confidence,
    },
    assignedTo,
    // Always the backoffice namespace: a proposal is disposed from the operator
    // caseload, and no portal surface can dispose one.
    assigneeKind: 'user',
    assignedToRoles,
    priority: review?.priority ?? null,
    dueDate,
    tenantId,
    organizationId,
    createdAt: now,
    updatedAt: now,
  })

  em.persist(task)
  await em.flush()

  await logDispositionTaskEvent(em, container, {
    workflowInstanceId: options.workflowInstanceId,
    stepInstanceId: task.stepInstanceId,
    branchInstanceId: task.branchInstanceId ?? null,
    eventType: 'USER_TASK_CREATED',
    eventData: {
      userTaskId: task.id,
      taskName: task.taskName,
      assignedTo: task.assignedTo,
      assignedToRoles: task.assignedToRoles,
      proposalId: options.proposalId,
      agentId: options.agentId,
      ...(task.priority ? { priority: task.priority } : {}),
      ...(dueDate ? { dueDate: dueDate.toISOString() } : {}),
    },
    userId: options.userId,
    tenantId,
    organizationId,
  })

  await emitDispositionTaskAssigned(task, instance)

  // Reminders and the deadline breach ride the SAME queue-backed scheduler a
  // USER_TASK's do — one job per authored offset plus one for the deadline, all
  // enqueued here with the deadline ABSOLUTE on the payload. A task with no
  // deadline schedules nothing. What the breach then DOES is escalate-only
  // (`lib/task-sla.ts` → `applyBreachHandling`): it never disposes the proposal
  // and never routes the run past it.
  await scheduleUserTaskSla({
    workflowInstanceId: options.workflowInstanceId,
    stepInstanceId: task.stepInstanceId,
    branchInstanceId: task.branchInstanceId ?? null,
    userTaskId: task.id,
    dueDate,
    reminders: review?.reminders ?? null,
    tenantId,
    organizationId,
    userId: options.userId,
    now,
  })

  return {
    userTaskId: task.id,
    stepInstanceId: task.stepInstanceId,
    assignedTo,
    assignedToRoles,
    dueDate,
  }
}

export interface CloseAgentDispositionTaskOptions {
  userTaskId: string
  /** The verdict that closed it — audit only; it never decides anything here. */
  disposition: string
  closedBy?: string | null
  tenantId: string
  organizationId: string
  now?: Date
}

/** Statuses a disposition task is still open in — anything else is already closed. */
const OPEN_TASK_STATUSES = ['PENDING', 'IN_PROGRESS'] as const

/**
 * Close the review task a disposed proposal no longer needs (A7).
 *
 * The decision has already been made and committed by the caller; this only
 * clears the work item so the operator's inbox stops offering a decision that
 * has already been taken. It deliberately does NOT complete the task through
 * `completeUserTask`: that would ADVANCE the run, and the run resumes on
 * `agent_orchestrator.proposal.ready` instead. Closing a task and advancing a
 * workflow are different acts, and only the second one belongs to the engine.
 *
 * Idempotent by construction: the status change is claimed with a conditional
 * UPDATE, so a redelivered close (or a task a human already completed) updates
 * zero rows and returns `noop`.
 */
export async function closeAgentDispositionTask(
  em: EntityManager,
  container: AwilixContainer,
  options: CloseAgentDispositionTaskOptions,
): Promise<'closed' | 'noop'> {
  const { tenantId, organizationId } = options
  const now = options.now ?? new Date()

  const task = await em.findOne(UserTask, {
    id: options.userTaskId,
    tenantId,
    organizationId,
  })
  if (!task) return 'noop'

  const claimed = await em.nativeUpdate(
    UserTask,
    {
      id: task.id,
      tenantId,
      organizationId,
      status: { $in: [...OPEN_TASK_STATUSES] },
    },
    {
      status: 'COMPLETED',
      completedAt: now,
      completedBy: options.closedBy ?? null,
      updatedAt: now,
    },
  )
  if (claimed === 0) return 'noop'

  await logDispositionTaskEvent(em, container, {
    workflowInstanceId: task.workflowInstanceId,
    stepInstanceId: task.stepInstanceId,
    ...(task.branchInstanceId ? { branchInstanceId: task.branchInstanceId } : {}),
    eventType: 'USER_TASK_COMPLETED',
    eventData: {
      userTaskId: task.id,
      taskName: task.taskName,
      closedBy: 'agent_disposition',
      disposition: options.disposition,
    },
    tenantId,
    organizationId,
  })

  return 'closed'
}

/**
 * Publish `workflows.task.assigned` for a disposition task, so it reaches the
 * notification subscriber the same way every other task does. Best-effort by
 * contract: the proposal is already pending and the task row already committed,
 * so a bus failure must never turn into a failed disposition.
 */
async function emitDispositionTaskAssigned(
  task: UserTask,
  instance: WorkflowInstance,
): Promise<void> {
  try {
    await emitWorkflowsEvent(
      'workflows.task.assigned',
      {
        taskId: task.id,
        taskName: task.taskName,
        workflowInstanceId: instance.id,
        workflowId: instance.workflowId,
        workflowName: instance.workflowId,
        assignedUserId: task.assignedTo ?? null,
        assignedToRoles: task.assignedToRoles ?? null,
        dueDate: task.dueDate ? task.dueDate.toISOString() : null,
        entityBindings: task.entityBindings ?? null,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId ?? null,
      },
      { persistent: true },
    )
  } catch (error) {
    logger.error('Failed to emit workflows.task.assigned for an agent disposition task', {
      component: 'agent-disposition-task',
      taskId: task.id,
      err: error,
    })
  }
}

async function logDispositionTaskEvent(
  em: EntityManager,
  container: AwilixContainer,
  event: Record<string, unknown>,
): Promise<void> {
  try {
    const eventLogger = container.resolve<{
      logWorkflowEvent: (em: EntityManager, event: Record<string, unknown>) => Promise<unknown>
    }>('eventLogger')
    await eventLogger.logWorkflowEvent(em, event)
  } catch (error) {
    logger.error('Failed to log an agent disposition task workflow event', {
      component: 'agent-disposition-task',
      eventType: event.eventType,
      err: error,
    })
  }
}
