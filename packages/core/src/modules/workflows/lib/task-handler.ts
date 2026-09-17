/**
 * Workflows Module - User Task Handler Service
 *
 * Handles user task lifecycle operations:
 * - Completing user tasks
 * - Claiming tasks from role queues
 * - Reassigning tasks
 * - Escalating overdue tasks
 *
 * Functional API (no classes) following Open Mercato conventions.
 */

import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import {
  UserTask,
  WorkflowInstance,
  WorkflowEvent,
  StepInstance,
} from '../data/entities'
import { executeWorkflow } from './workflow-executor'
import { findDefinitionForInstance } from './find-definition'
import {
  findTaskDecision,
  findTaskDecisionTransition,
  withRecordedDecision,
} from './task-decisions'
import { loadTaskDecisionContext } from './task-decision-context'
import { readRequiredFormFields } from './task-form-schema'
import * as stepHandler from './step-handler'
import * as transitionHandler from './transition-handler'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Tenant/organization the caller is acting within. Every task lookup filters on
 * it, so a task id from another tenant resolves to "not found" instead of being
 * mutated.
 */
export interface UserTaskScope {
  tenantId: string
  organizationId: string
}

/**
 * Shape of the `taskHandler` DI registration (`di.ts`).
 *
 * The functions below stay exported — third-party modules may import them and
 * `BACKWARD_COMPATIBILITY.md` §3 freezes import paths — but callers inside the
 * platform MUST resolve this service instead, per the module's first rule.
 */
export interface TaskHandlerService {
  completeUserTask: typeof completeUserTask
  claimUserTask: typeof claimUserTask
  releaseUserTask: typeof releaseUserTask
  reassignUserTask: typeof reassignUserTask
}

export interface CompleteUserTaskOptions {
  taskId: string
  formData: Record<string, any>
  userId: string
  comments?: string
  /**
   * The decision button the assignee pressed, when the step authored any.
   *
   * It does two things: it SELECTS the outgoing route (the decision's
   * `transitionId` wins over the first-valid-transition default), and it is
   * RECORDED as part of the completion payload. Omitted, completion behaves
   * exactly as it always did.
   */
  decisionId?: string
  scope: UserTaskScope
}

export class UserTaskError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message)
    this.name = 'UserTaskError'
  }
}

// ============================================================================
// User Task Completion
// ============================================================================

/**
 * Complete a user task and resume workflow execution
 *
 * This function:
 * 1. Validates the task exists and can be completed
 * 2. Updates the task with form data and completion info
 * 3. Merges form data into workflow context
 * 4. Logs completion event
 * 5. Resumes workflow execution
 *
 * @param em - Entity manager
 * @param container - DI container for workflow execution
 * @param options - Task completion options
 * @throws UserTaskError if task not found or validation fails
 */
export async function completeUserTask(
  em: EntityManager,
  container: AwilixContainer,
  options: CompleteUserTaskOptions
): Promise<void> {
  const { taskId, formData, userId, comments, decisionId, scope } = options

  // Fetch task
  const task = await em.findOne(UserTask, {
    id: taskId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: { $in: ['PENDING', 'IN_PROGRESS'] },
  })

  if (!task) {
    throw new UserTaskError(
      'Task not found or already completed',
      'TASK_NOT_FOUND',
      { taskId }
    )
  }

  // A task addressed to one person is that person's to finish. Tasks that name
  // nobody — agent dispositions, role queues nobody has claimed — stay open to
  // anyone the route's feature gate already admitted, so this narrows the
  // over-permissive case without stranding the unassigned ones.
  const claimant = task.claimedBy ?? task.assignedTo
  if (claimant && claimant !== userId) {
    throw new UserTaskError(
      'Task is assigned to another user',
      'TASK_ASSIGNED_TO_ANOTHER_USER',
      { taskId, assignedTo: claimant }
    )
  }

  // Validate form data against schema (simple validation for MVP)
  // In Phase 7, we'll add comprehensive JSON Schema validation
  if (task.formSchema) {
    try {
      validateFormData(formData, task.formSchema)
    } catch (error) {
      throw new UserTaskError(
        error instanceof Error ? error.message : 'Form validation failed',
        'FORM_VALIDATION_FAILED',
        { taskId, formSchema: task.formSchema, formData }
      )
    }
  }

  // Resolve the pressed decision BEFORE anything is mutated: an unknown
  // decision id must leave the task untouched rather than complete it down the
  // default route. The list is re-resolved from the instance's pinned
  // definition, so it is exactly the list the assignee was shown.
  const chosenDecision = decisionId
    ? findTaskDecision((await loadTaskDecisionContext(em, task)).decisions, decisionId)
    : null

  if (decisionId && !chosenDecision) {
    throw new UserTaskError(
      'Unknown decision for this task',
      'UNKNOWN_DECISION',
      { taskId, decisionId }
    )
  }

  // The chosen decision rides along inside the completion payload the task
  // already persists — no new column, and downstream route conditions can read
  // it once the payload is merged into the run context.
  const completionData = withRecordedDecision(formData, chosenDecision?.id)

  // Update task
  const now = new Date()
  task.status = 'COMPLETED'
  task.formData = completionData
  task.completedBy = userId
  task.completedAt = now
  task.comments = comments || null
  task.updatedAt = now

  await em.flush()

  // Fetch workflow instance
  const instance = await em.findOne(WorkflowInstance, task.workflowInstanceId)
  if (!instance) {
    throw new UserTaskError(
      'Workflow instance not found',
      'INSTANCE_NOT_FOUND',
      { workflowInstanceId: task.workflowInstanceId }
    )
  }

  // Branch-scoped completion: when the task belongs to a parallel branch,
  // merge form data into the branch namespace and resume just that branch.
  //
  // The decision is RECORDED here exactly as it is on the main path, but it does
  // not select the route: a branch advances through `resumeBranch` with its own
  // token, and overriding a branch's outgoing route is a parallel-execution
  // change rather than a task-surface one.
  if (task.branchInstanceId) {
    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      stepInstanceId: task.stepInstanceId,
      branchInstanceId: task.branchInstanceId,
      eventType: 'USER_TASK_COMPLETED',
      eventData: {
        taskId: task.id,
        taskName: task.taskName,
        completedBy: userId,
        formData: completionData,
        ...(chosenDecision ? { decisionId: chosenDecision.id } : {}),
      },
      userId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

    const { resumeBranch } = await import('./parallel-handler')
    const resumed = await resumeBranch(em, {
      instanceId: instance.id,
      branchInstanceId: task.branchInstanceId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
      contextMerge: completionData,
      exitStepInstanceId: task.stepInstanceId,
      exitOutput: { userTaskId: task.id, formData: completionData },
    })

    if (resumed) {
      await executeWorkflow(em, container, instance.id, { userId })
    }
    return
  }

  // Merge form data into workflow context
  instance.context = {
    ...instance.context,
    ...completionData,
  }
  instance.updatedAt = now

  // Log USER_TASK_COMPLETED event
  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    stepInstanceId: task.stepInstanceId,
    eventType: 'USER_TASK_COMPLETED',
    eventData: {
      taskId: task.id,
      taskName: task.taskName,
      completedBy: userId,
      formData: completionData,
      ...(chosenDecision ? { decisionId: chosenDecision.id } : {}),
    },
    userId,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  // Mark the step instance as completed
  const stepInstance = await em.findOne(StepInstance, {
    id: task.stepInstanceId,
    status: 'ACTIVE',
  })

  if (stepInstance) {
    await stepHandler.exitStep(em, stepInstance, { userTaskId: task.id, formData: completionData })
  }

  // Find the next automatic transition from the current step
  const currentStepId = instance.currentStepId

  // Load workflow definition to find transitions
  const definition = await findDefinitionForInstance(em, instance)

  if (!definition) {
    throw new UserTaskError(
      'Workflow definition not found',
      'DEFINITION_NOT_FOUND',
      { definitionId: instance.definitionId }
    )
  }

  const transitionContext = {
    workflowContext: instance.context,
    userId,
  }

  // A decision names the route to take. It is bound to the transition's durable
  // id, so it survives every route reorder, and it is looked up among the routes
  // LEAVING this step only — a button can never send the run down a route that
  // does not start where the run currently is. A decision whose route no longer
  // exists there falls through to the default evaluation rather than stranding
  // the run at a step it already completed.
  const decisionTransition = chosenDecision
    ? findTaskDecisionTransition(
        definition.definition.transitions || [],
        chosenDecision.transitionId,
        currentStepId
      )
    : null

  if (chosenDecision && !decisionTransition) {
    logger.warn('Task decision route not found on the current step; falling back to auto routing', {
      component: 'task-handler',
      taskId: task.id,
      decisionId: chosenDecision.id,
      transitionId: chosenDecision.transitionId,
      currentStepId,
    })
  }

  let selectedTransition = decisionTransition ?? null
  let targetStepId = selectedTransition?.toStepId ?? null

  if (!targetStepId) {
    // Find automatic transitions from current step
    const autoTransitions = (definition.definition.transitions || []).filter(
      (t: any) => t.fromStepId === currentStepId && t.trigger === 'auto'
    )

    if (autoTransitions.length === 0) {
      // No automatic transitions, workflow stays paused at current step
      return
    }

    // Find valid transitions using transition handler
    const validTransitions = await transitionHandler.findValidTransitions(
      em,
      instance,
      currentStepId,
      transitionContext
    )

    const firstValidTransition = validTransitions.find(t => t.isValid)

    if (!firstValidTransition || !firstValidTransition.transition) {
      // Resume workflow execution anyway, maybe conditions will be met later
      instance.status = 'RUNNING'
      await em.flush()
      return
    }

    targetStepId = firstValidTransition.transition.toStepId
    selectedTransition = firstValidTransition.transition
  }

  // Resume from the paused wait BEFORE executing the transition, exactly as
  // `sendSignal` does. Without it the executor's defense-in-depth PAUSED check
  // stops the run at the first step the completion traverses, so the instance
  // sits there as PAUSED and never reaches END. Guarded on PAUSED so completing
  // a stale task can never resurrect a CANCELLED or terminal run.
  if (instance.status === 'PAUSED') {
    instance.status = 'RUNNING'
    await em.flush()
  }

  // Execute the transition to move to next step

  const transitionResult = await transitionHandler.executeTransition(
    em,
    container,
    instance,
    currentStepId,
    targetStepId,
    { ...transitionContext, transitionId: selectedTransition?.transitionId },
  )

  if (!transitionResult.success) {
    logger.error('Transition failed', { component: 'task-handler', err: transitionResult.error })
    // Don't throw, just leave workflow in current state
    return
  }

  // Now continue workflow execution from the new step
  await executeWorkflow(em, container, instance.id, { userId })
}

/**
 * Whether the caller belongs to at least one of the task's queues.
 *
 * Exact string equality on role NAMES — no case folding and no trimming, because
 * the names on both sides come from the same tenant role table and normalizing
 * one side would let `Approver` claim an `approver` queue that RBAC treats as a
 * different role.
 */
function hasRoleOverlap(
  taskRoles: readonly string[],
  callerRoleNames: readonly string[],
): boolean {
  if (callerRoleNames.length === 0) return false
  const held = new Set(callerRoleNames)
  return taskRoles.some((role) => held.has(role))
}

/**
 * Claim a user task from a role queue
 *
 * Allows a user to claim a task that's assigned to their role(s).
 *
 * The claim itself is a COMPARE-AND-SET, not a read-then-write: the lookup
 * below only decides which error to report, while the row is taken with a
 * conditional `UPDATE … WHERE status = 'PENDING' AND claimed_by IS NULL`. Two
 * callers racing for the same task — which is exactly what the work inbox's
 * claim-next affordance produces — therefore cannot both win; the loser sees
 * zero affected rows and the same `TASK_NOT_FOUND` it would have seen a moment
 * later. Reading the status and flushing the entity afterwards would have let
 * both transactions read `PENDING` and both write.
 *
 * Membership in the queue is a REQUIREMENT, not a hint: a caller who holds none
 * of `assignedToRoles` is refused with the same `TASK_NOT_FOUND` a nonexistent
 * id produces, so a queue the caller does not belong to is indistinguishable
 * from a task that is not there. Holding `workflows.tasks.claim` admits you to
 * the endpoint; it does not admit you to somebody else's queue.
 *
 * `assignedToRoles` and `callerRoleNames` are both role NAMES — the Studio
 * picker writes names, the engine copies them onto the task, and `auth.roles`
 * carries names. A role RENAME therefore orphans existing assignments; moving
 * the comparison onto immutable role ids is a coordinated data + authored-
 * definition migration and is deliberately not done here.
 *
 * @param em - Entity manager
 * @param taskId - Task ID to claim
 * @param userId - User claiming the task
 * @param scope - Tenant/organization the caller acts within; both the lookup and
 *   the conditional update filter on it, so a task belonging to another tenant
 *   is never reachable and never writable
 * @param callerRoleNames - Server-derived role names of the caller (`auth.roles`),
 *   never client-supplied. Required rather than optional so a caller that cannot
 *   supply them fails to compile instead of silently claiming any queue.
 * @throws UserTaskError if task cannot be claimed
 */
export async function claimUserTask(
  em: EntityManager,
  taskId: string,
  userId: string,
  scope: UserTaskScope,
  callerRoleNames: readonly string[]
): Promise<void> {
  const task = await em.findOne(UserTask, {
    id: taskId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'PENDING',
  })

  if (!task) {
    throw new UserTaskError(
      'Task not found or already claimed',
      'TASK_NOT_FOUND',
      { taskId }
    )
  }

  if (task.assignedTo) {
    throw new UserTaskError(
      'Task is already assigned to a specific user',
      'TASK_ALREADY_ASSIGNED',
      { taskId, assignedTo: task.assignedTo }
    )
  }

  if (!task.assignedToRoles || task.assignedToRoles.length === 0) {
    throw new UserTaskError(
      'Task is not assigned to any roles',
      'TASK_NOT_ROLE_ASSIGNED',
      { taskId }
    )
  }

  if (!hasRoleOverlap(task.assignedToRoles, callerRoleNames)) {
    throw new UserTaskError(
      'Task not found or already claimed',
      'TASK_NOT_FOUND',
      { taskId }
    )
  }

  const now = new Date()
  const claimed = await em.nativeUpdate(
    UserTask,
    {
      id: taskId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: 'PENDING',
      claimedBy: null,
    },
    {
      claimedBy: userId,
      claimedAt: now,
      status: 'IN_PROGRESS',
      updatedAt: now,
    },
  )

  if (claimed === 0) {
    throw new UserTaskError(
      'Task not found or already claimed',
      'TASK_NOT_FOUND',
      { taskId }
    )
  }

  // The conditional update above already wrote the row; mirroring it onto the
  // managed entity keeps the caller's identity-mapped copy from reporting the
  // pre-claim state back to the client.
  task.claimedBy = userId
  task.claimedAt = now
  task.status = 'IN_PROGRESS'
  task.updatedAt = now

  await em.flush()

  // Log event
  const instance = await em.findOne(WorkflowInstance, task.workflowInstanceId)
  if (instance) {
    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      stepInstanceId: task.stepInstanceId,
      eventType: 'USER_TASK_STARTED',
      eventData: {
        taskId: task.id,
        taskName: task.taskName,
        claimedBy: userId,
      },
      userId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })
  }
}

/**
 * Release a claimed task back to its role queue.
 *
 * The counterpart of `claimUserTask`, and deliberately its mirror image: the
 * write is the same compare-and-set, guarded on the caller still being the
 * claimant, so a task reassigned or completed in the meantime is refused rather
 * than silently reopened. It uses the EXISTING statuses — the row goes back to
 * `PENDING` — because adding a `UserTaskStatus` value is an Ask-First
 * state-machine change and a released task is exactly as pending as it was
 * before anyone claimed it.
 *
 * @throws UserTaskError if the task is not the caller's to release
 */
export async function releaseUserTask(
  em: EntityManager,
  taskId: string,
  userId: string,
  scope: UserTaskScope
): Promise<void> {
  const task = await em.findOne(UserTask, {
    id: taskId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'IN_PROGRESS',
  })

  if (!task) {
    throw new UserTaskError(
      'Task not found or not claimed',
      'TASK_NOT_FOUND',
      { taskId }
    )
  }

  if (task.claimedBy !== userId) {
    throw new UserTaskError(
      'Task is claimed by another user',
      'TASK_ASSIGNED_TO_ANOTHER_USER',
      { taskId, claimedBy: task.claimedBy }
    )
  }

  const now = new Date()
  const released = await em.nativeUpdate(
    UserTask,
    {
      id: taskId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: 'IN_PROGRESS',
      claimedBy: userId,
    },
    {
      claimedBy: null,
      claimedAt: null,
      status: 'PENDING',
      updatedAt: now,
    },
  )

  if (released === 0) {
    throw new UserTaskError(
      'Task not found or not claimed',
      'TASK_NOT_FOUND',
      { taskId }
    )
  }

  task.claimedBy = null
  task.claimedAt = null
  task.status = 'PENDING'
  task.updatedAt = now

  await em.flush()

  const instance = await em.findOne(WorkflowInstance, task.workflowInstanceId)
  if (instance) {
    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      stepInstanceId: task.stepInstanceId,
      eventType: 'USER_TASK_RELEASED',
      eventData: {
        taskId: task.id,
        taskName: task.taskName,
        releasedBy: userId,
      },
      userId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })
  }
}

// ============================================================================
// User Task Reassignment
// ============================================================================

/**
 * The new owner of a task, as the reassign route resolved it.
 *
 * At least one of the two must be non-empty, and the route enforces it: the
 * shape §6.4 makes uncompletable is precisely "no assignee AND no role queue",
 * so a reassignment that produced it would be the one write that can create the
 * problem reassignment exists to fix.
 */
export interface ReassignUserTaskTarget {
  assignedTo?: string | null
  assignedToRoles?: readonly string[] | null
}

export interface ReassignUserTaskOptions {
  taskId: string
  /** Who performed the reassignment — recorded on `reassigned_by`. */
  userId: string
  target: ReassignUserTaskTarget
  reason?: string | null
  scope: UserTaskScope
}

/**
 * Statuses a task can be reassigned in.
 *
 * The same pair `completeUserTask` accepts: moving a COMPLETED or CANCELLED row
 * to somebody else records an audit trail for work that can never be done, and
 * the assignee would be handed a task whose Complete button always fails.
 */
const REASSIGNABLE_STATUSES: readonly string[] = ['PENDING', 'IN_PROGRESS']

/**
 * Move a task to a different assignee or role queue, with an audit trail.
 *
 * This is the ACT half of the §6.4 model's central asymmetry: administration
 * widens seeing, never acting, so an administrator who can see a colleague's
 * task — or a task that belongs to nobody at all — takes it first and the taking
 * is permanently recorded. It is also the documented remedy for the one shape
 * the model leaves uncompletable (no assignee, no claim, no role queue), which
 * is why it deliberately accepts a task in exactly that state.
 *
 * No new `UserTaskStatus` value is introduced. The audit lives on the columns
 * Phase 4a added (`reassigned_by` / `reassigned_at` / `reassign_reason`) plus a
 * `WorkflowEvent`, and a reassigned task is exactly as pending or in-progress as
 * it was — the same choice `releaseUserTask` made, and the one Phase 3a's
 * failure queue made when it reused `PAUSED` plus a marker.
 *
 * An in-flight CLAIM is always released. Handing a row to somebody else while a
 * colleague still holds it would leave `claimedBy ?? assignedTo` naming the old
 * claimant, so the predicate would keep treating the task as theirs and the new
 * assignee could not act on what they were just given.
 *
 * @throws UserTaskError when the task is absent from the caller's scope or is
 *         in a terminal status
 */
export async function reassignUserTask(
  em: EntityManager,
  options: ReassignUserTaskOptions,
): Promise<UserTask> {
  const { taskId, userId, target, reason, scope } = options

  const task = await em.findOne(UserTask, {
    id: taskId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  if (!task) {
    throw new UserTaskError('Task not found', 'TASK_NOT_FOUND', { taskId })
  }

  if (!REASSIGNABLE_STATUSES.includes(task.status)) {
    throw new UserTaskError(
      'Task is no longer open and cannot be reassigned',
      'TASK_NOT_REASSIGNABLE',
      { taskId, status: task.status },
    )
  }

  const assignedTo = target.assignedTo ?? null
  const assignedToRoles =
    target.assignedToRoles && target.assignedToRoles.length > 0 ? [...target.assignedToRoles] : null

  const previous = {
    assignedTo: task.assignedTo ?? null,
    assignedToRoles: task.assignedToRoles ?? null,
    claimedBy: task.claimedBy ?? null,
  }

  const now = new Date()

  task.assignedTo = assignedTo
  // Reassignment is a backoffice administration act and its target is resolved
  // from the tenant's user/role vocabulary, so the row lands in the backoffice
  // namespace. Portal reassignment would need a portal principal picker and is
  // not part of this surface.
  task.assigneeKind = 'user'
  task.assignedToRoles = assignedToRoles
  task.claimedBy = null
  task.claimedAt = null
  // A queued task must be PENDING to be claimable, and a task whose claim was
  // just released is exactly as pending as it was before anyone claimed it.
  if (task.status === 'IN_PROGRESS') task.status = 'PENDING'
  task.reassignedBy = userId
  task.reassignedAt = now
  task.reassignReason = reason ?? null
  task.updatedAt = now

  await em.flush()

  const instance = await em.findOne(WorkflowInstance, task.workflowInstanceId)
  if (instance) {
    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      stepInstanceId: task.stepInstanceId,
      branchInstanceId: task.branchInstanceId ?? null,
      eventType: 'USER_TASK_REASSIGNED',
      eventData: {
        taskId: task.id,
        taskName: task.taskName,
        reassignedBy: userId,
        reason: reason ?? null,
        from: previous,
        to: { assignedTo, assignedToRoles },
      },
      userId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })
  }

  return task
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Log workflow event to event sourcing table
 */
async function logWorkflowEvent(
  em: EntityManager,
  event: {
    workflowInstanceId: string
    stepInstanceId: string | null
    branchInstanceId?: string | null
    eventType: string
    eventData: any
    userId?: string
    tenantId: string
    organizationId: string
  }
): Promise<WorkflowEvent> {
  const workflowEvent = em.create(WorkflowEvent, {
    ...event,
    occurredAt: new Date(),
  })

  await em.persist(workflowEvent).flush()
  return workflowEvent
}

/**
 * Validate form data against the task's authored schema.
 *
 * Required-field presence in BOTH accepted `formSchema` shapes: the JSON-Schema
 * form and the `{ fields: [...] }` form the Studio writes, whose per-field
 * `required: true` flag this used to ignore entirely — so a task authored in
 * the visual editor validated nothing however many fields its author marked
 * mandatory. Both shapes now resolve through `lib/task-form-schema.ts`, the
 * same module the renderer walks, so they cannot drift apart again.
 *
 * Presence-only, deliberately: type checking would need the full JSON-Schema
 * vocabulary, and what matters is that a required field cannot be skipped.
 *
 * @param formData - User-provided form data
 * @param formSchema - Authored schema, in either accepted shape
 * @throws Error if validation fails
 */
export function validateFormData(
  formData: Record<string, any>,
  formSchema: unknown
): void {
  for (const field of readRequiredFormFields(formSchema)) {
    if (!(field in formData) || formData[field] === null || formData[field] === undefined) {
      throw new Error(`Required field missing: ${field}`)
    }
  }
}
