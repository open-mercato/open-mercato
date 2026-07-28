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
}

export interface CompleteUserTaskOptions {
  taskId: string
  formData: Record<string, any>
  userId: string
  comments?: string
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
  const { taskId, formData, userId, comments, scope } = options

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

  // Update task
  const now = new Date()
  task.status = 'COMPLETED'
  task.formData = formData
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
  if (task.branchInstanceId) {
    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      stepInstanceId: task.stepInstanceId,
      branchInstanceId: task.branchInstanceId,
      eventType: 'USER_TASK_COMPLETED',
      eventData: { taskId: task.id, taskName: task.taskName, completedBy: userId, formData },
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
      contextMerge: formData,
      exitStepInstanceId: task.stepInstanceId,
      exitOutput: { userTaskId: task.id, formData },
    })

    if (resumed) {
      await executeWorkflow(em, container, instance.id, { userId })
    }
    return
  }

  // Merge form data into workflow context
  instance.context = {
    ...instance.context,
    ...formData,
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
      formData,
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
    await stepHandler.exitStep(em, stepInstance, { userTaskId: task.id, formData })
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

  // Find automatic transitions from current step
  const autoTransitions = (definition.definition.transitions || []).filter(
    (t: any) => t.fromStepId === currentStepId && t.trigger === 'auto'
  )

  if (autoTransitions.length === 0) {
    // No automatic transitions, workflow stays paused at current step
    return
  }

  // Find valid transitions using transition handler
  const transitionContext = {
    workflowContext: instance.context,
    userId,
  }

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

  // Execute the transition to move to next step

  const transitionResult = await transitionHandler.executeTransition(
    em,
    container,
    instance,
    currentStepId,
    firstValidTransition.transition.toStepId,
    transitionContext
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
 * @param em - Entity manager
 * @param taskId - Task ID to claim
 * @param userId - User claiming the task
 * @param scope - Tenant/organization the caller acts within; both the lookup and
 *   the conditional update filter on it, so a task belonging to another tenant
 *   is never reachable and never writable
 * @throws UserTaskError if task cannot be claimed
 */
export async function claimUserTask(
  em: EntityManager,
  taskId: string,
  userId: string,
  scope: UserTaskScope
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
 * Validate form data against JSON schema (basic validation for MVP)
 *
 * In Phase 7, we'll implement comprehensive JSON Schema validation.
 * For MVP, we do basic type checking.
 *
 * @param formData - User-provided form data
 * @param formSchema - JSON schema defining expected structure
 * @throws Error if validation fails
 */
function validateFormData(
  formData: Record<string, any>,
  formSchema: any
): void {
  // For MVP: Basic validation - just check required fields exist
  if (!formSchema || !formSchema.properties) {
    return // No schema to validate against
  }

  const requiredFields = formSchema.required || []

  for (const field of requiredFields) {
    if (!(field in formData) || formData[field] === null || formData[field] === undefined) {
      throw new Error(`Required field missing: ${field}`)
    }
  }

  // Additional type validation can be added in Phase 7
  // For now, this basic validation is sufficient
}
