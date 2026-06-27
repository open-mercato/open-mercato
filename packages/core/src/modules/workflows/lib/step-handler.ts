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
  WorkflowBranchInstance,
  WorkflowDefinition,
  StepInstance,
  UserTask,
  WorkflowEvent,
  type StepInstanceStatus,
  type WorkflowStepType,
} from '../data/entities'
import { parseDuration } from './duration'
import { logWorkflowEvent } from './event-logger'
import { findWorkflowDefinition } from './find-definition'
import { validateAgainstPorts } from './port-contract'
import type { WorkflowIoContract } from '../data/validators'

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
  waitReason?: 'USER_TASK' | 'SIGNAL' | 'TIMER' | 'FORK'
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
  context: StepExecutionContext,
  branch?: WorkflowBranchInstance | null
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
    branchInstanceId: branch ? branch.id : null,
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

  await em.persist(stepInstance).flush()

  // Log STEP_ENTERED event
  await logStepEvent(em, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    ...(branch ? { branchInstanceId: branch.id } : {}),
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
  container?: any,
  branch?: WorkflowBranchInstance | null
): Promise<StepExecutionResult> {
  try {
    // Enter the step (create step instance)
    const stepInstance = await enterStep(em, instance, stepId, context, branch)

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
      container,
      branch
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
  container?: any,
  branch?: WorkflowBranchInstance | null
): Promise<StepExecutionResult> {
  const stepType: WorkflowStepType = stepDef.stepType

  switch (stepType) {
    case 'START':
      return handleStartStep(stepDef, context)

    case 'END':
      return handleEndStep(stepDef, context)

    case 'AUTOMATED':
      return await handleAutomatedStep(em, instance, stepInstance, stepDef, context, container, branch)

    case 'USER_TASK':
      return await handleUserTaskStep(em, instance, stepInstance, stepDef, context, branch)

    case 'SUB_WORKFLOW':
      if (!container) {
        throw new StepExecutionError(
          'Container required for SUB_WORKFLOW execution',
          'CONTAINER_REQUIRED',
          { stepType }
        )
      }
      return await handleSubWorkflowStep(em, container, instance, stepInstance, stepDef, context)

    case 'WAIT_FOR_SIGNAL':
      return await handleWaitForSignalStep(em, instance, stepInstance, stepDef, context, branch)

    case 'WAIT_FOR_TIMER':
      return await handleWaitForTimerStep(em, instance, stepInstance, stepDef, context, branch)

    case 'PARALLEL_FORK': {
      // Entering a fork opens branch tokens and parks the root token in the
      // FORKED state; the interleaved loop in the executor drives the branches.
      if (branch) {
        // Nested forks are rejected by definition validation; fail closed.
        throw new StepExecutionError(
          'Nested PARALLEL_FORK is not supported',
          'NESTED_FORK_NOT_SUPPORTED',
          { stepType, stepId: stepDef.stepId }
        )
      }
      const definition = await em.findOne(WorkflowDefinition, { id: instance.definitionId })
      if (!definition) {
        throw new StepExecutionError(
          `Workflow definition not found: ${instance.definitionId}`,
          'DEFINITION_NOT_FOUND',
          { definitionId: instance.definitionId }
        )
      }
      const { openFork } = await import('./parallel-handler')
      await openFork(em, instance, definition, stepDef)
      return { status: 'WAITING', waitReason: 'FORK', outputData: { stepType: 'PARALLEL_FORK', forkStepId: stepDef.stepId } }
    }

    case 'PARALLEL_JOIN':
      // The join is a synchronization point handled by the parallel loop
      // (branches are marked COMPLETED on arrival; the loop fires the join).
      // Executing the step itself is a no-op.
      return { status: 'COMPLETED', outputData: { stepType: 'PARALLEL_JOIN', timestamp: new Date().toISOString() } }

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
 * Executes activities defined in step configuration.
 * Supports both sync and async activities.
 */
async function handleAutomatedStep(
  em: EntityManager,
  instance: WorkflowInstance,
  stepInstance: StepInstance,
  stepDef: any,
  context: StepExecutionContext,
  container?: any,
  branch?: WorkflowBranchInstance | null
): Promise<StepExecutionResult> {
  // Extract activities from step definition
  const activities = stepDef.activities || []

  if (activities.length === 0) {
    // No activities defined - immediate completion (legacy behavior)
    return {
      status: 'COMPLETED',
      outputData: {
        stepType: 'AUTOMATED',
        timestamp: new Date().toISOString(),
      },
    }
  }

  // Import activity executor
  const { executeActivities } = await import('./activity-executor')

  try {
    // Execute activities with proper context
    const results = await executeActivities(em, container, activities, {
      workflowInstance: instance,
      workflowContext: context.workflowContext,
      stepContext: { stepId: stepDef.stepId, stepName: stepDef.stepName },
      stepInstanceId: stepInstance.id,
      userId: context.userId,
    })

    // Check if there are pending async activities
    const pendingActivities = results.filter(r => r.async && !r.success)
    if (pendingActivities.length > 0) {
      // Workflow should pause and wait for async activities
      const now = new Date()
      if (branch) {
        branch.status = 'WAITING_FOR_ACTIVITIES'
        branch.updatedAt = now
      } else {
        instance.status = 'WAITING_FOR_ACTIVITIES'
        instance.pausedAt = now
        instance.updatedAt = now
      }
      await em.flush()

      return {
        status: 'WAITING',
        waitReason: 'SIGNAL', // Reuse SIGNAL wait reason (will be resumed by activity completion)
        outputData: {
          pendingActivities: pendingActivities.map(r => ({
            activityId: r.activityId,
            activityName: r.activityName,
            jobId: r.jobId,
          })),
        },
      }
    }

    // Check for failures in sync activities
    const failures = results.filter(r => !r.success && !r.async)
    if (failures.length > 0) {
      const errorMessages = failures.map(f => `${f.activityName || f.activityId}: ${f.error}`).join('; ')
      return {
        status: 'FAILED',
        error: `${failures.length} activity(ies) failed: ${errorMessages}`,
        outputData: {
          failures: failures.map(f => ({
            activityId: f.activityId,
            activityName: f.activityName,
            error: f.error,
            retryCount: f.retryCount,
          })),
        },
      }
    }

    // INVOKE_AGENT (agent_orchestrator) integration:
    // A `__park` marker means the agent's proposal was routed to a human — park
    // the instance on the signal exactly like handleWaitForSignalStep. The step
    // declares `signalConfig.signalName`, so sendSignal (relaxed) resumes it when
    // agent_orchestrator's dispose path fires `agent_orchestrator.proposal.ready`.
    const parkResult = results.find((r) => r.output && (r.output as any).__park)
    if (parkResult) {
      const signalName = (parkResult.output as any).__park.signalName as string
      const proposalId = (parkResult.output as any).proposalId
      const now = new Date()
      await logStepEvent(em, {
        workflowInstanceId: instance.id,
        stepInstanceId: stepInstance.id,
        ...(branch ? { branchInstanceId: branch.id } : {}),
        eventType: 'SIGNAL_AWAITING',
        eventData: { signalName, proposalId, reason: 'INVOKE_AGENT' },
        userId: context.userId,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
      })
      if (branch) {
        branch.status = 'PAUSED'
        branch.updatedAt = now
      } else {
        instance.status = 'PAUSED'
        instance.pausedAt = now
        instance.updatedAt = now
      }
      await em.flush()
      return {
        status: 'WAITING',
        waitReason: 'SIGNAL',
        outputData: { signalName, proposalId, awaitingSince: now },
      }
    }

    // Inline-resolved agent result (auto_approved / informative): surface the
    // disposition into context (top-level, matching the human-path signal merge)
    // so the outgoing transition can branch (effector vs skip) uniformly.
    const inlineAgent = results.find(
      (r) => r.output && typeof (r.output as any).kind === 'string' && 'agentId' in (r.output as any),
    )
    if (inlineAgent && !branch) {
      const out = inlineAgent.output as any
      if (out.kind === 'auto_approved') {
        instance.context = {
          ...instance.context,
          disposition: 'auto_approved',
          agentProposalId: out.proposalId,
          proposalPayload: out.proposalPayload,
        }
        instance.updatedAt = new Date()
        await em.flush()
      }
    }

    // All activities completed successfully
    const activityOutputs = results.reduce((acc, r) => {
      if (r.output) {
        acc[r.activityId] = r.output
      }
      return acc
    }, {} as Record<string, any>)

    return {
      status: 'COMPLETED',
      outputData: {
        stepType: 'AUTOMATED',
        timestamp: new Date().toISOString(),
        activityResults: activityOutputs,
        activityCount: results.length,
      },
    }
  } catch (error: any) {
    return {
      status: 'FAILED',
      error: `Activity execution failed: ${error.message}`,
    }
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
  context: StepExecutionContext,
  branch?: WorkflowBranchInstance | null
): Promise<StepExecutionResult> {
  const userTaskConfig = stepDef.userTaskConfig || {}

  // Handle assignedTo - if it's an array, treat it as roles
  let assignedTo = userTaskConfig.assignedTo || null
  let assignedToRoles = userTaskConfig.assignedToRoles || null

  if (Array.isArray(assignedTo)) {
    assignedToRoles = assignedTo
    assignedTo = null
  }

  // Create user task
  const now = new Date()
  const userTask = em.create(UserTask, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    branchInstanceId: branch ? branch.id : null,
    taskName: stepDef.stepName,
    description: stepDef.description || null,
    status: 'PENDING',
    formSchema: userTaskConfig.formSchema || null,
    formData: null,
    assignedTo: assignedTo,
    assignedToRoles: assignedToRoles,
    dueDate: userTaskConfig.slaDuration ? calculateDueDate(userTaskConfig.slaDuration) : null,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
    createdAt: now,
    updatedAt: now,
  })

  await em.persist(userTask).flush()

  // Log USER_TASK_CREATED event
  await logStepEvent(em, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    ...(branch ? { branchInstanceId: branch.id } : {}),
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

  // Pause execution - waits for user task completion. For a branch, only the
  // branch pauses; sibling branches keep running.
  if (branch) {
    branch.status = 'PAUSED'
    branch.updatedAt = now
  } else {
    instance.status = 'PAUSED'
    instance.updatedAt = now
  }
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
  let childContext = mapInputData(instance.context, inputMapping || {})

  // Import workflow executor functions
  const { startWorkflow, executeWorkflow } = await import('./workflow-executor')

  try {
    // Resolve the child definition to read its declared port contract (if any).
    // Validation is opt-in by contract presence: only children that declare
    // `definition.io` ports are checked, so legacy untyped sub-workflows behave
    // exactly as before.
    const childDefinition = await findWorkflowDefinition(em, {
      workflowId: subWorkflowId,
      version,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })
    const ioContract = (childDefinition?.definition as { io?: WorkflowIoContract } | undefined)?.io

    // Validate/coerce mapped inputs against the child's declared input ports.
    if (ioContract?.inputs?.length) {
      const { coerced, errors } = validateAgainstPorts(childContext, ioContract.inputs)
      if (errors.length > 0) {
        const message = `Sub-workflow input validation failed: ${errors.map((e) => e.message).join('; ')}`
        await logStepEvent(em, {
          workflowInstanceId: instance.id,
          stepInstanceId: stepInstance.id,
          eventType: 'SUB_WORKFLOW_FAILED',
          eventData: { subWorkflowId, reason: 'INPUT_VALIDATION', error: message },
          userId: context.userId,
          tenantId: instance.tenantId,
          organizationId: instance.organizationId,
        })
        return { status: 'FAILED', error: message }
      }
      childContext = coerced
    }

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
      // Map output data from child context to parent context (+ io-port
      // validation). Shared with the async resume path so both apply identical
      // mapping/validation rules.
      const mapped = mapSubWorkflowOutput(result.context, outputMapping || {}, ioContract)
      if (mapped.error) {
        await logStepEvent(em, {
          workflowInstanceId: instance.id,
          stepInstanceId: stepInstance.id,
          eventType: 'SUB_WORKFLOW_FAILED',
          eventData: { childInstanceId: childInstance.id, reason: 'OUTPUT_VALIDATION', error: mapped.error },
          userId: context.userId,
          tenantId: instance.tenantId,
          organizationId: instance.organizationId,
        })
        return { status: 'FAILED', error: mapped.error }
      }
      const outputData = mapped.outputData

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
      // The child parked at its first async/agent step (RUNNING / PAUSED /
      // WAITING_FOR_ACTIVITIES). Make the SUB_WORKFLOW step suspendable: park the
      // parent on SUB_WORKFLOW_SIGNAL_NAME. The child's terminal completeWorkflow
      // enqueues a resume job that resumes this parent (mirrors the INVOKE_AGENT
      // __park branch above).
      const { SUB_WORKFLOW_SIGNAL_NAME } = await import('./activity-executor')
      const now = new Date()
      await logStepEvent(em, {
        workflowInstanceId: instance.id,
        stepInstanceId: stepInstance.id,
        eventType: 'SIGNAL_AWAITING',
        eventData: {
          signalName: SUB_WORKFLOW_SIGNAL_NAME,
          childInstanceId: childInstance.id,
          reason: 'SUB_WORKFLOW',
        },
        userId: context.userId,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
      })
      instance.status = 'PAUSED'
      instance.pausedAt = now
      instance.updatedAt = now
      await em.flush()
      return {
        status: 'WAITING',
        waitReason: 'SIGNAL',
        outputData: { childInstanceId: childInstance.id },
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

/**
 * Handle WAIT_FOR_SIGNAL step - pause workflow until signal received
 *
 * Creates a waiting state and pauses the workflow until an external signal
 * with the matching signal name is received. The signal payload will be merged
 * into the workflow context when received.
 */
async function handleWaitForSignalStep(
  em: EntityManager,
  instance: WorkflowInstance,
  stepInstance: StepInstance,
  stepDef: any,
  context: StepExecutionContext,
  branch?: WorkflowBranchInstance | null
): Promise<StepExecutionResult> {
  const signalConfig = stepDef.signalConfig || {}
  const signalName = signalConfig.signalName || stepDef.stepId
  const timeout = signalConfig.timeout ? parseDuration(signalConfig.timeout) : null

  const now = new Date()

  // Log signal awaiting event
  await logStepEvent(em, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    ...(branch ? { branchInstanceId: branch.id } : {}),
    eventType: 'SIGNAL_AWAITING',
    eventData: {
      signalName,
      timeout,
      description: stepDef.description,
    },
    userId: context.userId,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  // Pause execution (branch-scoped when running inside a parallel branch)
  if (branch) {
    branch.status = 'PAUSED'
    branch.updatedAt = now
  } else {
    instance.status = 'PAUSED'
    instance.pausedAt = now
    instance.updatedAt = now
  }
  await em.flush()

  // Return WAITING status to halt executor
  return {
    status: 'WAITING',
    waitReason: 'SIGNAL',
    outputData: {
      signalName,
      timeout,
      awaitingSince: now,
    },
  }
}

/**
 * Handle WAIT_FOR_TIMER step - pause workflow until a timer fires.
 *
 * Reads `duration` (relative, e.g. "PT5M") or `until` (ISO 8601 datetime) from
 * `stepDef.config` (preferred — matches StepsEditor) or `stepDef.timerConfig`.
 * Enqueues a delayed timer job on the workflow-activities queue; when the job
 * is processed by the activity worker, it calls `timerHandler.fireTimer` to
 * resume the workflow.
 */
async function handleWaitForTimerStep(
  em: EntityManager,
  instance: WorkflowInstance,
  stepInstance: StepInstance,
  stepDef: any,
  context: StepExecutionContext,
  branch?: WorkflowBranchInstance | null
): Promise<StepExecutionResult> {
  const timerConfig = stepDef.config || stepDef.timerConfig || {}
  const duration: string | undefined = timerConfig.duration
  const until: string | undefined = timerConfig.until

  if (!duration && !until) {
    throw new StepExecutionError(
      'WAIT_FOR_TIMER requires either "duration" (e.g., "PT5M") or "until" (ISO 8601 datetime)',
      'TIMER_CONFIG_MISSING',
      { stepId: stepDef.stepId }
    )
  }

  let fireAtMs: number
  if (until) {
    const targetDate = new Date(until)
    if (isNaN(targetDate.getTime())) {
      throw new StepExecutionError(
        `WAIT_FOR_TIMER invalid "until" datetime: ${until}`,
        'TIMER_CONFIG_INVALID',
        { until }
      )
    }
    fireAtMs = targetDate.getTime()
  } else {
    fireAtMs = Date.now() + parseDuration(duration as string)
  }

  const delayMs = fireAtMs - Date.now()
  const fireAt = new Date(fireAtMs)

  // Immediate-fire path: skip the queue round-trip if the timer is in the past
  if (delayMs <= 0) {
    return {
      status: 'COMPLETED',
      outputData: {
        stepType: 'WAIT_FOR_TIMER',
        timerFiredImmediately: true,
        fireAt,
        duration,
        until,
      },
    }
  }

  const now = new Date()

  // Enqueue delayed timer job via the shared activity queue.
  // Imported here to avoid a top-level cycle between step-handler and activity-executor.
  const { enqueueTimerJob } = await import('./activity-executor')
  const jobId = await enqueueTimerJob({
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    branchInstanceId: branch ? branch.id : undefined,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
    userId: context.userId,
    fireAt: fireAt.toISOString(),
    delayMs,
  })

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    ...(branch ? { branchInstanceId: branch.id } : {}),
    eventType: 'TIMER_AWAITING',
    eventData: {
      fireAt: fireAt.toISOString(),
      duration: duration || null,
      until: until || null,
      jobId,
    },
    userId: context.userId,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  if (branch) {
    branch.status = 'PAUSED'
    branch.updatedAt = now
  } else {
    instance.status = 'PAUSED'
    instance.pausedAt = now
    instance.updatedAt = now
  }
  await em.flush()

  return {
    status: 'WAITING',
    waitReason: 'TIMER',
    outputData: {
      fireAt,
      duration,
      until,
      jobId,
    },
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

// parseDuration is imported from ./duration

/**
 * Log step-related event to event sourcing table
 */
async function logStepEvent(
  em: EntityManager,
  event: {
    workflowInstanceId: string
    stepInstanceId: string
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

/**
 * Map a completed sub-workflow's child context to parent output and validate it
 * against the child's declared output ports. Shared by the synchronous
 * (inline) completion branch in `handleSubWorkflowStep` and the async parent
 * resume path so both apply identical mapping/validation rules. Returns the
 * mapped `outputData` on success or an `error` message on port-validation
 * failure (never throws).
 */
export function mapSubWorkflowOutput(
  childContext: Record<string, any>,
  outputMapping: Record<string, string>,
  ioContract?: WorkflowIoContract
): { outputData: Record<string, any>; error?: undefined } | { outputData?: undefined; error: string } {
  let outputData = mapOutputData(childContext, outputMapping || {})

  if (ioContract?.outputs?.length) {
    const { coerced, errors } = validateAgainstPorts(outputData, ioContract.outputs)
    if (errors.length > 0) {
      return { error: `Sub-workflow output validation failed: ${errors.map((e) => e.message).join('; ')}` }
    }
    outputData = coerced
  }

  return { outputData }
}
