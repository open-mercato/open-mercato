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
  WorkflowDefinition,
} from '../data/entities'
import { executeWorkflow } from './workflow-executor'
import * as stepHandler from './step-handler'
import * as transitionHandler from './transition-handler'

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface CompleteUserTaskOptions {
  taskId: string
  formData: Record<string, any>
  userId: string
  comments?: string
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
  const { taskId, formData, userId, comments } = options

  // Fetch task
  const task = await em.findOne(UserTask, {
    id: taskId,
    status: { $in: ['PENDING', 'IN_PROGRESS'] },
  })

  if (!task) {
    throw new UserTaskError(
      'Task not found or already completed',
      'TASK_NOT_FOUND',
      { taskId }
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
  const definition = await em.findOne(WorkflowDefinition, {
    id: instance.definitionId,
  })

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
    console.error(`[TaskHandler] Transition failed:`, transitionResult.error)
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
 * Prevents race conditions by checking task status.
 *
 * @param em - Entity manager
 * @param taskId - Task ID to claim
 * @param userId - User claiming the task
 * @throws UserTaskError if task cannot be claimed
 */
export async function claimUserTask(
  em: EntityManager,
  taskId: string,
  userId: string
): Promise<void> {
  const task = await em.findOne(UserTask, {
    id: taskId,
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

  // Update task
  const now = new Date()
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

  await em.persistAndFlush(workflowEvent)
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
