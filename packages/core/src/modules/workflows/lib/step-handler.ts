/**
 * Workflows Module - Step Handler Service
 *
 * Handles individual workflow step execution:
 * - Creating step instances when entering a step
 * - Executing step logic based on step type (START, END, AUTOMATED, USER_TASK)
 * - Completing step instances when exiting
 *
 * Functional API (no classes) following Open Mercato conventions.
 */

import { EntityManager } from '@mikro-orm/core'
import {
  WorkflowInstance,
  WorkflowDefinition,
  StepInstance,
  UserTask,
  WorkflowEvent,
  type StepInstanceStatus,
  type WorkflowStepType,
} from '../data/entities'

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface StepExecutionContext {
  workflowContext: Record<string, any>
  userId?: string
  triggerData?: any
}

export interface StepExecutionResult {
  status: 'COMPLETED' | 'WAITING' | 'FAILED'
  outputData?: any
  nextSteps?: string[] // For parallel forks (Phase 7)
  waitReason?: 'USER_TASK' | 'SIGNAL' | 'TIMER'
  error?: string
}

export class StepExecutionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message)
    this.name = 'StepExecutionError'
  }
}

// ============================================================================
// Main Step Execution Functions
// ============================================================================

/**
 * Enter a workflow step - create step instance and mark as ACTIVE
 *
 * @param em - Entity manager
 * @param instance - Workflow instance
 * @param stepId - Step ID to enter
 * @param context - Execution context
 * @returns Created step instance
 */
export async function enterStep(
  em: EntityManager,
  instance: WorkflowInstance,
  stepId: string,
  context: StepExecutionContext
): Promise<StepInstance> {
  // Load workflow definition to get step details
  const definition = await em.findOne(WorkflowDefinition, {
    id: instance.definitionId,
  })

  if (!definition) {
    throw new StepExecutionError(
      `Workflow definition not found: ${instance.definitionId}`,
      'DEFINITION_NOT_FOUND',
      { definitionId: instance.definitionId }
    )
  }

  // Find step in definition
  const stepDef = definition.definition.steps.find((s: any) => s.stepId === stepId)
  if (!stepDef) {
    throw new StepExecutionError(
      `Step not found in workflow definition: ${stepId}`,
      'STEP_NOT_FOUND',
      { workflowId: definition.workflowId, stepId }
    )
  }

  const now = new Date()

  // Create step instance
  const stepInstance = em.create(StepInstance, {
    workflowInstanceId: instance.id,
    stepId: stepDef.stepId,
    stepName: stepDef.stepName,
    stepType: stepDef.stepType,
    status: 'ACTIVE',
    inputData: context.triggerData || null,
    enteredAt: now,
    retryCount: 0,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
    createdAt: now,
    updatedAt: now,
  })

  await em.persistAndFlush(stepInstance)

  // Log STEP_ENTERED event
  await logStepEvent(em, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    eventType: 'STEP_ENTERED',
    eventData: {
      stepId: stepDef.stepId,
      stepName: stepDef.stepName,
      stepType: stepDef.stepType,
    },
    userId: context.userId,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  return stepInstance
}

/**
 * Exit a workflow step - mark as completed and record timing
 *
 * @param em - Entity manager
 * @param stepInstance - Step instance to exit
 * @param outputData - Optional output data from step execution
 */
export async function exitStep(
  em: EntityManager,
  stepInstance: StepInstance,
  outputData?: any
): Promise<void> {
  const now = new Date()

  // Calculate execution time if we have enteredAt
  let executionTimeMs: number | null = null
  if (stepInstance.enteredAt) {
    executionTimeMs = now.getTime() - stepInstance.enteredAt.getTime()
  }

  // Update step instance
  stepInstance.status = 'COMPLETED'
  stepInstance.outputData = outputData || null
  stepInstance.exitedAt = now
  stepInstance.executionTimeMs = executionTimeMs
  stepInstance.updatedAt = now

  await em.flush()

  // Log STEP_EXITED event
  await logStepEvent(em, {
    workflowInstanceId: stepInstance.workflowInstanceId,
    stepInstanceId: stepInstance.id,
    eventType: 'STEP_EXITED',
    eventData: {
      stepId: stepInstance.stepId,
      status: 'COMPLETED',
      executionTimeMs,
      hasOutput: !!outputData,
    },
    tenantId: stepInstance.tenantId,
    organizationId: stepInstance.organizationId,
  })
}

/**
 * Execute a workflow step based on its type
 *
 * Main entry point for step execution. Handles:
 * - START: Immediate completion
 * - END: Workflow completion
 * - AUTOMATED: Activity execution (MVP: immediate completion)
 * - USER_TASK: Create user task and wait
 * - SUB_WORKFLOW: Invoke child workflow
 *
 * @param em - Entity manager
 * @param instance - Workflow instance
 * @param stepId - Step ID to execute
 * @param context - Execution context
 * @param container - DI container (required for SUB_WORKFLOW steps)
 * @returns Execution result with status and output
 */
export async function executeStep(
  em: EntityManager,
  instance: WorkflowInstance,
  stepId: string,
  context: StepExecutionContext,
  container?: any
): Promise<StepExecutionResult> {
  try {
    // Enter the step (create step instance)
    const stepInstance = await enterStep(em, instance, stepId, context)

    // Load workflow definition to get step configuration
    const definition = await em.findOne(WorkflowDefinition, {
      id: instance.definitionId,
    })

    if (!definition) {
      throw new StepExecutionError(
        `Workflow definition not found: ${instance.definitionId}`,
        'DEFINITION_NOT_FOUND',
        { definitionId: instance.definitionId }
      )
    }

    const stepDef = definition.definition.steps.find((s: any) => s.stepId === stepId)
    if (!stepDef) {
      throw new StepExecutionError(
        `Step not found: ${stepId}`,
        'STEP_NOT_FOUND',
        { stepId }
      )
    }

    // Execute based on step type
    const result = await executeStepByType(
      em,
      instance,
      stepInstance,
      stepDef,
      context,
      container
    )

    // If step completed, exit it
    if (result.status === 'COMPLETED') {
      await exitStep(em, stepInstance, result.outputData)
    }

    return result
  } catch (error) {
    // Handle step execution errors
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Try to mark step as failed if we have a step instance
    try {
      const failedStepInstance = await em.findOne(StepInstance, {
        workflowInstanceId: instance.id,
        stepId,
        status: 'ACTIVE',
      })

      if (failedStepInstance) {
        failedStepInstance.status = 'FAILED'
        failedStepInstance.errorData = {
          error: errorMessage,
          details: error instanceof StepExecutionError ? error.details : undefined,
        }
        failedStepInstance.exitedAt = new Date()
        failedStepInstance.updatedAt = new Date()
        await em.flush()

        await logStepEvent(em, {
          workflowInstanceId: instance.id,
          stepInstanceId: failedStepInstance.id,
          eventType: 'STEP_FAILED',
          eventData: { error: errorMessage },
          tenantId: instance.tenantId,
          organizationId: instance.organizationId,
        })
      }
    } catch (updateError) {
      // Swallow update errors to preserve original error
      console.error('Failed to update step instance with error:', updateError)
    }

    return {
      status: 'FAILED',
      error: errorMessage,
    }
  }
}

// ============================================================================
// Step Type Handlers
// ============================================================================

/**
 * Execute step based on its type
 *
 * @param em - Entity manager
 * @param instance - Workflow instance
 * @param stepInstance - Step instance
 * @param stepDef - Step definition from workflow
 * @param context - Execution context
 * @returns Execution result
 */
async function executeStepByType(
  em: EntityManager,
  instance: WorkflowInstance,
  stepInstance: StepInstance,
  stepDef: any,
  context: StepExecutionContext,
  container?: any
): Promise<StepExecutionResult> {
  const stepType: WorkflowStepType = stepDef.stepType

  switch (stepType) {
    case 'START':
      return handleStartStep(stepDef, context)

    case 'END':
      return handleEndStep(stepDef, context)

    case 'AUTOMATED':
      return await handleAutomatedStep(em, instance, stepInstance, stepDef, context)

    case 'USER_TASK':
      return await handleUserTaskStep(em, instance, stepInstance, stepDef, context)

    case 'SUB_WORKFLOW':
      if (!container) {
        throw new StepExecutionError(
          'Container required for SUB_WORKFLOW execution',
          'CONTAINER_REQUIRED',
          { stepType }
        )
      }
      return await handleSubWorkflowStep(em, container, instance, stepInstance, stepDef, context)

    case 'PARALLEL_FORK':
    case 'PARALLEL_JOIN':
    case 'WAIT_FOR_SIGNAL':
    case 'WAIT_FOR_TIMER':
      // These will be implemented in later phases
      throw new StepExecutionError(
        `Step type not yet implemented: ${stepType}`,
        'STEP_TYPE_NOT_IMPLEMENTED',
        { stepType }
      )

    default:
      throw new StepExecutionError(
        `Unknown step type: ${stepType}`,
        'UNKNOWN_STEP_TYPE',
        { stepType }
      )
  }
}

/**
 * Handle START step - no-op, immediately complete
 */
function handleStartStep(
  stepDef: any,
  context: StepExecutionContext
): StepExecutionResult {
  return {
    status: 'COMPLETED',
    outputData: {
      stepType: 'START',
      timestamp: new Date().toISOString(),
    },
  }
}

/**
 * Handle END step - mark as complete
 */
function handleEndStep(
  stepDef: any,
  context: StepExecutionContext
): StepExecutionResult {
  return {
    status: 'COMPLETED',
    outputData: {
      stepType: 'END',
      timestamp: new Date().toISOString(),
      finalContext: context.workflowContext,
    },
  }
}

/**
 * Handle AUTOMATED step - execute activities
 *
 * For MVP (Phase 3), we immediately complete AUTOMATED steps.
 * Full activity execution will be implemented in Phase 4.
 */
async function handleAutomatedStep(
  em: EntityManager,
  instance: WorkflowInstance,
  stepInstance: StepInstance,
  stepDef: any,
  context: StepExecutionContext
): Promise<StepExecutionResult> {
  // For MVP: Just complete the step
  // In Phase 4, we'll execute activities defined in the step config

  return {
    status: 'COMPLETED',
    outputData: {
      stepType: 'AUTOMATED',
      timestamp: new Date().toISOString(),
      // In Phase 4: activityResults will be populated here
    },
  }
}

/**
 * Handle USER_TASK step - create user task and enter waiting state
 *
 * Creates a UserTask entity and returns WAITING status.
 * The workflow will pause until the task is completed by a user.
 */
async function handleUserTaskStep(
  em: EntityManager,
  instance: WorkflowInstance,
  stepInstance: StepInstance,
  stepDef: any,
  context: StepExecutionContext
): Promise<StepExecutionResult> {
  const userTaskConfig = stepDef.userTaskConfig || {}

  // Create user task
  const now = new Date()
  const userTask = em.create(UserTask, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    taskName: stepDef.stepName,
    description: stepDef.description || null,
    status: 'PENDING',
    formSchema: userTaskConfig.formSchema || null,
    formData: null,
    assignedTo: userTaskConfig.assignedTo || null,
    assignedToRoles: userTaskConfig.assignedToRoles || null,
    dueDate: userTaskConfig.slaDuration ? calculateDueDate(userTaskConfig.slaDuration) : null,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
    createdAt: now,
    updatedAt: now,
  })

  console.log('[UserTask] Creating task:', {
    id: userTask.id,
    taskName: userTask.taskName,
    workflowInstanceId: instance.id,
    assignedTo: userTask.assignedTo,
    assignedToRoles: userTask.assignedToRoles,
    tenantId: userTask.tenantId,
    organizationId: userTask.organizationId,
  })

  await em.persistAndFlush(userTask)

  console.log('[UserTask] Task persisted to database:', userTask.id)

  // Log USER_TASK_CREATED event
  await logStepEvent(em, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    eventType: 'USER_TASK_CREATED',
    eventData: {
      userTaskId: userTask.id,
      taskName: userTask.taskName,
      assignedTo: userTask.assignedTo,
      assignedToRoles: userTask.assignedToRoles,
    },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  // Pause workflow execution - workflow waits for user task completion
  instance.status = 'PAUSED'
  instance.updatedAt = now
  await em.flush()

  return {
    status: 'WAITING',
    waitReason: 'USER_TASK',
    outputData: {
      userTaskId: userTask.id,
    },
  }
}

/**
 * Handle SUB_WORKFLOW step - invoke another workflow and wait for completion
 *
 * Creates a child workflow instance with mapped input data,
 * executes it synchronously, and returns mapped output data.
 */
async function handleSubWorkflowStep(
  em: EntityManager,
  container: any,
  instance: WorkflowInstance,
  stepInstance: StepInstance,
  stepDef: any,
  context: StepExecutionContext
): Promise<StepExecutionResult> {
  const { subWorkflowId, inputMapping, outputMapping, version } = stepDef.config || {}

  if (!subWorkflowId) {
    return {
      status: 'FAILED',
      error: 'Sub-workflow ID not specified in step configuration'
    }
  }

  // Map input data from parent context to child context
  const childContext = mapInputData(instance.context, inputMapping || {})

  // Import workflow executor functions
  const { startWorkflow, executeWorkflow } = await import('./workflow-executor')

  try {
    // Start child workflow with parent metadata
    const childInstance = await startWorkflow(em, {
      workflowId: subWorkflowId,
      version,
      initialContext: childContext,
      correlationKey: instance.correlationKey || undefined,
      metadata: {
        ...instance.metadata,
        labels: {
          ...instance.metadata?.labels,
          parentInstanceId: instance.id,
          parentStepId: stepDef.stepId,
          parentStepInstanceId: stepInstance.id,
        },
      },
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

    // Log sub-workflow invocation event
    await logStepEvent(em, {
      workflowInstanceId: instance.id,
      stepInstanceId: stepInstance.id,
      eventType: 'SUB_WORKFLOW_STARTED',
      eventData: {
        childInstanceId: childInstance.id,
        subWorkflowId,
        version,
        inputData: childContext,
      },
      userId: context.userId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

    // Execute child workflow synchronously
    const result = await executeWorkflow(em, container, childInstance.id, {
      userId: context.userId,
    })

    // Handle child workflow result
    if (result.status === 'COMPLETED') {
      // Map output data from child context to parent context
      const outputData = mapOutputData(result.context, outputMapping || {})

      await logStepEvent(em, {
        workflowInstanceId: instance.id,
        stepInstanceId: stepInstance.id,
        eventType: 'SUB_WORKFLOW_COMPLETED',
        eventData: {
          childInstanceId: childInstance.id,
          outputData,
        },
        userId: context.userId,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
      })

      return {
        status: 'COMPLETED',
        outputData,
      }
    } else if (result.status === 'FAILED') {
      await logStepEvent(em, {
        workflowInstanceId: instance.id,
        stepInstanceId: stepInstance.id,
        eventType: 'SUB_WORKFLOW_FAILED',
        eventData: {
          childInstanceId: childInstance.id,
          error: result.errors?.join(', '),
        },
        userId: context.userId,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
      })

      return {
        status: 'FAILED',
        error: `Sub-workflow failed: ${result.errors?.join(', ')}`,
      }
    } else {
      // WAITING, PAUSED, etc. - For synchronous execution, treat as error
      return {
        status: 'FAILED',
        error: `Sub-workflow ended in unexpected state: ${result.status}`,
      }
    }
  } catch (error: any) {
    await logStepEvent(em, {
      workflowInstanceId: instance.id,
      stepInstanceId: stepInstance.id,
      eventType: 'SUB_WORKFLOW_FAILED',
      eventData: {
        subWorkflowId,
        error: error.message,
      },
      userId: context.userId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

    return {
      status: 'FAILED',
      error: `Sub-workflow execution failed: ${error.message}`,
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Log step-related event to event sourcing table
 */
async function logStepEvent(
  em: EntityManager,
  event: {
    workflowInstanceId: string
    stepInstanceId: string
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
 * Calculate due date from ISO 8601 duration string
 *
 * @param duration - ISO 8601 duration (e.g., "P1D" for 1 day)
 * @returns Due date
 */
function calculateDueDate(duration: string): Date {
  // Simple implementation for MVP
  // Supports: P1D (1 day), P1H (1 hour), P1W (1 week)
  const now = new Date()

  const daysMatch = duration.match(/P(\d+)D/)
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10)
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  }

  const hoursMatch = duration.match(/PT(\d+)H/)
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1], 10)
    return new Date(now.getTime() + hours * 60 * 60 * 1000)
  }

  const weeksMatch = duration.match(/P(\d+)W/)
  if (weeksMatch) {
    const weeks = parseInt(weeksMatch[1], 10)
    return new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000)
  }

  // Default: 1 day
  return new Date(now.getTime() + 24 * 60 * 60 * 1000)
}

/**
 * Get nested value from object using dot notation
 *
 * @param obj - Source object
 * @param path - Dot-notation path (e.g., "user.email")
 * @returns Value at path or undefined
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}

/**
 * Set nested value in object using dot notation
 *
 * @param obj - Target object
 * @param path - Dot-notation path (e.g., "user.email")
 * @param value - Value to set
 */
function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.')
  const lastKey = keys.pop()!
  const target = keys.reduce((current, key) => {
    if (!(key in current)) current[key] = {}
    return current[key]
  }, obj)
  target[lastKey] = value
}

/**
 * Map data from source context using mapping configuration
 *
 * @param sourceContext - Source data object
 * @param mapping - Mapping configuration (targetKey -> sourcePath)
 * @returns Mapped data object
 */
function mapInputData(
  sourceContext: Record<string, any>,
  mapping: Record<string, string>
): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [targetKey, sourcePath] of Object.entries(mapping)) {
    const value = getNestedValue(sourceContext, sourcePath)
    if (value !== undefined) {
      setNestedValue(result, targetKey, value)
    }
  }

  // If no mapping provided, pass entire context
  return Object.keys(result).length > 0 ? result : sourceContext
}

/**
 * Map output data from child context back to parent
 *
 * @param childContext - Child workflow context
 * @param mapping - Mapping configuration (targetKey -> sourcePath)
 * @returns Mapped output data
 */
function mapOutputData(
  childContext: Record<string, any>,
  mapping: Record<string, string>
): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [targetKey, sourcePath] of Object.entries(mapping)) {
    const value = getNestedValue(childContext, sourcePath)
    if (value !== undefined) {
      setNestedValue(result, targetKey, value)
    }
  }

  // If no mapping provided, pass entire child context
  return Object.keys(result).length > 0 ? result : childContext
}
