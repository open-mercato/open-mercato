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
  StepInstance,
  UserTask,
  WorkflowEvent,
  type StepInstanceStatus,
  type WorkflowStepType,
} from '../data/entities'
import { emitWorkflowsEvent } from '../events'
import { calculateDueDate, parseDuration } from './duration'
import {
  CONDITION_STEP_TYPE,
  conditionReadContext,
  evaluateConditionExpression,
  readWaitForConditionConfig,
} from './condition-handler'
import { mapAgentResultToContext } from './agent-result-mapping'
import {
  WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY,
  buildAgentOutcomeContextEntry,
  mapDispositionToAgentOutcome,
} from './outcome-routing'
import { logWorkflowEvent } from './event-logger'
import { DRY_RUN_EVENT_TYPES, isDryRunInstance } from './dry-run'
import { findDefinitionForInstance } from './find-definition'
import { resolveDefinitionInterpolationMode, type WorkflowInterpolationMode } from './interpolation-pipeline'
import {
  collectResolvedEntityTypes,
  flattenTaskText,
  resolveTaskAssignment,
  resolveTaskDeadlineDuration,
  resolveTaskDecisions,
  resolveTaskEntityBindings,
  resolveTaskText,
  type TaskInterpolate,
} from './task-resolution'
import { scheduleUserTaskSla } from './task-sla'
import type { TaskQuickActionInput } from './task-quick-action'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findWorkflowDefinition } from './find-definition'
import { validateAgainstPorts } from './port-contract'
import type { WorkflowIoContract } from '../data/validators'

const logger = createLogger('workflows')

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface StepExecutionContext {
  workflowContext: Record<string, any>
  userId?: string
  triggerData?: any
  // Populated by executeStep from the loaded definition; absent means lenient.
  interpolationMode?: WorkflowInterpolationMode
  // Populated by executeStep from the loaded definition so task notifications
  // can name the workflow the way its author did.
  workflowName?: string
}

export interface StepExecutionResult {
  status: 'COMPLETED' | 'WAITING' | 'FAILED'
  outputData?: any
  nextSteps?: string[] // For parallel forks (Phase 7)
  waitReason?: 'USER_TASK' | 'SIGNAL' | 'TIMER' | 'FORK' | 'CONDITION'
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
  const definition = await findDefinitionForInstance(em, instance)

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
 * Mark a step instance FAILED and log `STEP_FAILED`.
 *
 * The ONE place a step row becomes FAILED, so a failure the run went on to
 * tolerate leaves the same durable trace a fatal one does. Tolerating a failure
 * is a routing decision, not a reason to forget it happened: without the row and
 * the event there is nothing for the run verdict to be computed from, and
 * rerun-from-step refuses the step it exists for because its latest attempt
 * still reads ACTIVE.
 *
 * Idempotent — a second call on an already-FAILED row is a no-op, so a handler
 * that reported the failure itself never produces two `STEP_FAILED` rows.
 */
export async function markStepInstanceFailed(
  em: EntityManager,
  stepInstance: StepInstance,
  failure: {
    error: string
    details?: unknown
    branchInstanceId?: string | null
    userId?: string
  }
): Promise<void> {
  if (stepInstance.status === 'FAILED') return

  const now = new Date()
  stepInstance.status = 'FAILED'
  stepInstance.errorData = {
    error: failure.error,
    details: failure.details ?? undefined,
  }
  stepInstance.exitedAt = now
  stepInstance.updatedAt = now
  await em.flush()

  await logStepEvent(em, {
    workflowInstanceId: stepInstance.workflowInstanceId,
    stepInstanceId: stepInstance.id,
    ...(failure.branchInstanceId ? { branchInstanceId: failure.branchInstanceId } : {}),
    eventType: 'STEP_FAILED',
    eventData: { stepId: stepInstance.stepId, error: failure.error },
    ...(failure.userId ? { userId: failure.userId } : {}),
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
    const definition = await findDefinitionForInstance(em, instance)

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
      {
        ...context,
        interpolationMode: resolveDefinitionInterpolationMode(definition.definition),
        workflowName: definition.workflowName,
      },
      container,
      branch
    )

    // If step completed, exit it
    if (result.status === 'COMPLETED') {
      await exitStep(em, stepInstance, result.outputData)
    } else if (result.status === 'FAILED') {
      // A handler that REPORTS a failure (`handleAutomatedStep` returns
      // `{status:'FAILED'}` for a failed sync activity) never reaches the catch
      // below, so before this the row stayed ACTIVE for ever and no
      // `STEP_FAILED` was logged — the failure existed only in a value the
      // caller was free to tolerate. The row is now terminal on both paths.
      await markStepInstanceFailed(em, stepInstance, {
        error: result.error ?? 'Step execution failed',
        details: result.outputData,
        branchInstanceId: branch?.id ?? null,
        userId: context.userId,
      })
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
        await markStepInstanceFailed(em, failedStepInstance, {
          error: errorMessage,
          details: error instanceof StepExecutionError ? error.details : undefined,
          branchInstanceId: branch?.id ?? null,
          userId: context.userId,
        })
      }
    } catch (updateError) {
      // Swallow update errors to preserve original error
      logger.error('Failed to update step instance with error', { err: updateError })
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

    case 'IF_ELSE':
    case 'SWITCH':
      return handleBranchingStep(stepType)

    case 'WAIT_FOR_SIGNAL':
      return await handleWaitForSignalStep(em, instance, stepInstance, stepDef, context, branch)

    case 'WAIT_FOR_TIMER':
      return await handleWaitForTimerStep(em, instance, stepInstance, stepDef, context, branch)

    case 'WAIT_FOR_CONDITION':
      return await handleWaitForConditionStep(em, instance, stepInstance, stepDef, context, branch)

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
      const definition = await findDefinitionForInstance(em, instance)
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
 * Handle IF_ELSE / SWITCH steps - pure transition sugar.
 *
 * Branching nodes carry NO runtime semantics of their own: they behave exactly
 * like an AUTOMATED step with no activities and complete immediately. Every
 * routing decision stays in `findValidTransitions`, which already evaluates the
 * business_rules condition language and orders candidates by priority, so the
 * unconditioned "otherwise" route wins only when no cased route matches.
 */
function handleBranchingStep(stepType: 'IF_ELSE' | 'SWITCH'): StepExecutionResult {
  return {
    status: 'COMPLETED',
    outputData: {
      stepType,
      timestamp: new Date().toISOString(),
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
      interpolationMode: context.interpolationMode,
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
      const agentActivity = activities.find(
        (a: any) => a.activityType === 'INVOKE_AGENT' && a.activityId === inlineAgent.activityId,
      )
      const mappedPatch = mapAgentResultToContext(
        {
          kind: out.kind,
          agentId: out.agentId,
          proposalId: out.proposalId,
          proposalPayload: out.proposalPayload,
          data: out.data,
        },
        agentActivity?.config?.outputMapping,
      )
      const contextPatch =
        mappedPatch ??
        (out.kind === 'auto_approved'
          ? {
              disposition: 'auto_approved',
              agentProposalId: out.proposalId,
              proposalPayload: out.proposalPayload,
            }
          : null)
      // Outcome routing (spec 7.2): record which of the five fixed disposition
      // kinds this step resolved to under an ENGINE-OWNED context key. The
      // executor routes on this marker alone — never on the author-visible
      // `disposition` key — which is what makes branching on a disposition
      // wiring rather than context string-matching.
      const resolvedOutcome = mapDispositionToAgentOutcome(out.kind)
      const outcomeMarker = resolvedOutcome
        ? {
            [WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]: buildAgentOutcomeContextEntry(
              stepInstance.stepId,
              resolvedOutcome,
              out.proposalId,
            ),
          }
        : null

      const nextContext = { ...instance.context, ...(contextPatch ?? {}), ...(outcomeMarker ?? {}) }
      if (contextPatch || outcomeMarker) {
        instance.context = nextContext
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
 * Resolve a user task's deadline from its authored duration.
 *
 * An unparseable duration fails the step with an actionable message instead of
 * quietly resolving to some default the author never asked for.
 */
function resolveUserTaskDeadline(stepId: string, slaDuration: string): Date {
  try {
    return calculateDueDate(slaDuration)
  } catch (error) {
    throw new StepExecutionError(
      `Invalid user task deadline "${slaDuration}": ${error instanceof Error ? error.message : String(error)}`,
      'INVALID_USER_TASK_DEADLINE',
      { stepId, slaDuration }
    )
  }
}

/**
 * Publish the declared `workflows.task.assigned` domain event for a freshly
 * created task, alongside (never instead of) the internal `USER_TASK_CREATED`
 * audit row. It carries both the individual assignee and the role queue so the
 * notification subscriber can reach role-assigned tasks too.
 *
 * Delivery is at-least-once and consumers must be idempotent; a bus failure
 * must never break workflow execution, so this is strictly best-effort.
 */
async function emitTaskAssignedEvent(
  userTask: UserTask,
  instance: WorkflowInstance,
  context: StepExecutionContext,
  quickAction?: TaskQuickActionInput
): Promise<void> {
  try {
    await emitWorkflowsEvent(
      'workflows.task.assigned',
      {
        // Everything the notification quick-action rule needs, and nothing more.
        // ABSENT means "unknown", and the subscriber falls back to the deep
        // link — a quick action must never be offered on a guess.
        ...(quickAction ? { quickAction } : {}),
        taskId: userTask.id,
        taskName: userTask.taskName,
        workflowInstanceId: instance.id,
        workflowId: instance.workflowId,
        workflowName: context.workflowName ?? instance.workflowId,
        assignedUserId: userTask.assignedTo ?? null,
        assignedToRoles: userTask.assignedToRoles ?? null,
        dueDate: userTask.dueDate ? userTask.dueDate.toISOString() : null,
        // Additive: the records the task is about. Modules that own those
        // records subscribe and surface the task on their own turf — the
        // customers module writes a `CustomerTodoLink` from this. Workflows
        // never reaches into another module's tables to do it itself.
        entityBindings: userTask.entityBindings ?? null,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId ?? null,
      },
      { persistent: true }
    )
  } catch (error) {
    logger.error('Failed to emit workflows.task.assigned', {
      component: 'step-handler',
      taskId: userTask.id,
      err: error,
    })
  }

  if (userTask.assigneeKind !== 'customer' || !userTask.assignedTo) return

  try {
    // Addressed to ONE portal principal (`recipientUserId` is what narrows the
    // SSE audience) and carrying an id and nothing else. The receiver asks the
    // authorized portal API what the task is; the bridge never carries the
    // answer, so a mis-scoped connection learns nothing from it.
    await emitWorkflowsEvent(
      'workflows.task.portal_assigned',
      {
        taskId: userTask.id,
        recipientUserId: userTask.assignedTo,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId ?? null,
      },
      { persistent: false }
    )
  } catch (error) {
    logger.error('Failed to emit workflows.task.portal_assigned', {
      component: 'step-handler',
      taskId: userTask.id,
      err: error,
    })
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

  // Everything an author can write on a task — its title, its instructions, its
  // decision labels, its dynamic assignee and its entity bindings — is resolved
  // HERE, once, against the context the run has at creation time. Resolving
  // later would let a definition edit retro-change what a running task says.
  // Lenient on purpose: an unresolved dynamic assignee is what the fallback role
  // queue exists for, not a reason to fail the step.
  //
  // Imported dynamically like every other activity-executor use in this file, so
  // the module graph stays acyclic.
  const { interpolateVariables } = await import('./activity-executor')
  const interpolate: TaskInterpolate = (value) =>
    interpolateVariables(value, context.workflowContext, instance)

  const assignment = resolveTaskAssignment(userTaskConfig, interpolate)
  if (assignment.fellBackToRoles) {
    logger.warn('Dynamic task assignee resolved to nothing; falling back to the role queue', {
      component: 'step-handler',
      stepId: stepDef.stepId,
      workflowInstanceId: instance.id,
      assignedToRoles: assignment.assignedToRoles,
    })
  }
  if (assignment.fellBackFromCustomer) {
    // The author addressed this to a portal principal and no id resolved, so it
    // landed in the backoffice namespace instead. The work is still reachable,
    // but by a different audience than intended — that is worth saying out loud.
    logger.warn('Portal task assignee resolved to nothing; task created for the backoffice instead', {
      component: 'step-handler',
      stepId: stepDef.stepId,
      workflowInstanceId: instance.id,
    })
  }

  const { bindings, unresolved } = resolveTaskEntityBindings(userTaskConfig.entityBindings, interpolate)
  if (unresolved.length) {
    logger.warn('Task entity bindings skipped because their ids did not resolve', {
      component: 'step-handler',
      stepId: stepDef.stepId,
      workflowInstanceId: instance.id,
      unresolved,
    })
  }

  const taskName = String(interpolate(stepDef.stepName) ?? stepDef.stepName)
  const instructions = resolveTaskText(userTaskConfig.instructions, interpolate)
  const decisions = resolveTaskDecisions(userTaskConfig.decisions, interpolate)
  const deadlineDuration = resolveTaskDeadlineDuration(userTaskConfig)

  // Create user task
  const now = new Date()

  // Dry run (spec section 8.2): a simulation raises NO real task. The row is
  // what everything else hangs off — the `workflows.task.assigned` event and
  // therefore the notification subscriber, the SLA reminder/breach queue jobs,
  // and every Work Inbox and task-list query — so suppressing the row is what
  // suppresses all of them, rather than a filter at each read site that a new
  // reader could forget. Everything above still runs, so the report says
  // exactly who the task WOULD have gone to. The step still WAITS: the author
  // simulates the decision through step-through or the advance action.
  if (isDryRunInstance(instance)) {
    await logStepEvent(em, {
      workflowInstanceId: instance.id,
      stepInstanceId: stepInstance.id,
      ...(branch ? { branchInstanceId: branch.id } : {}),
      eventType: DRY_RUN_EVENT_TYPES.userTaskSimulated,
      eventData: {
        taskName,
        assignedTo: assignment.assignedTo,
        assignedToRoles: assignment.assignedToRoles,
        assigneeKind: assignment.assigneeKind,
        ...(bindings.length ? { entityBindings: bindings } : {}),
        ...(decisions.length ? { decisions } : {}),
        ...(deadlineDuration ? { deadlineDuration } : {}),
      },
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

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
      outputData: { simulated: true, wouldRaiseTask: taskName },
    }
  }

  const userTask = em.create(UserTask, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    branchInstanceId: branch ? branch.id : null,
    taskName,
    description: flattenTaskText(instructions) ?? stepDef.description ?? null,
    status: 'PENDING',
    formSchema: userTaskConfig.formSchema || null,
    formData: null,
    assignedTo: assignment.assignedTo,
    // Decided by `resolveTaskAssignment` from the authored `assigneeKind`, and
    // `'customer'` only when an individual assignee actually resolved. Written
    // explicitly rather than left to the column default so the discriminator is
    // a decision at every creation site, not an accident.
    assigneeKind: assignment.assigneeKind,
    assignedToRoles: assignment.assignedToRoles,
    entityBindings: bindings.length ? bindings : null,
    // Denormalized from the SAME resolved bindings, so the two can never drift.
    // Null for a task about nothing, which is what the vacuous-pass rule reads.
    entityTypes: bindings.length ? collectResolvedEntityTypes(bindings) : null,
    priority: userTaskConfig.priority ?? null,
    dueDate: deadlineDuration
      ? resolveUserTaskDeadline(stepDef.stepId, deadlineDuration)
      : null,
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
      ...(bindings.length ? { entityBindings: bindings } : {}),
      ...(userTask.priority ? { priority: userTask.priority } : {}),
      ...(decisions.length ? { decisions } : {}),
      ...(assignment.fellBackToRoles ? { assignmentFallback: 'roles' } : {}),
    },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  await emitTaskAssignedEvent(userTask, instance, context, {
    decisions: decisions.map((decision) => ({ id: decision.id })),
    formSchema: userTask.formSchema ?? null,
    editablePrefilled: userTaskConfig.editablePrefilled ?? null,
  })

  // Reminders and the deadline breach are scheduled HERE, once, with the
  // deadline already absolute on each job payload — see `lib/task-sla.ts`. A
  // task with no deadline schedules nothing at all.
  await scheduleUserTaskSla({
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    branchInstanceId: branch ? branch.id : null,
    userTaskId: userTask.id,
    dueDate: userTask.dueDate ?? null,
    reminders: userTaskConfig.reminders ?? null,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
    userId: context.userId,
    now,
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

/**
 * Handle WAIT_FOR_CONDITION step - pause until a context predicate holds.
 *
 * Evaluates the step's ConditionExpression against the token read context. A
 * predicate that already holds completes the step inline with no queue job at
 * all. Otherwise the token parks and a delayed `kind: 'condition'` poll job is
 * enqueued carrying an ABSOLUTE `deadlineAt`, so neither a slow queue nor a
 * re-enqueue can extend the configured timeout. The event-driven wake
 * (`conditionHandler.wakeConditionWaiters`) is the fast path on top of it.
 */
async function handleWaitForConditionStep(
  em: EntityManager,
  instance: WorkflowInstance,
  stepInstance: StepInstance,
  stepDef: any,
  context: StepExecutionContext,
  branch?: WorkflowBranchInstance | null
): Promise<StepExecutionResult> {
  const config = readWaitForConditionConfig(stepDef)

  const data = {
    ...conditionReadContext(instance, branch ?? null),
    ...(context.workflowContext || {}),
  }

  const met = await evaluateConditionExpression({
    condition: config.condition,
    data,
    instanceId: instance.id,
    userId: context.userId,
  })

  const now = new Date()

  if (met) {
    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      stepInstanceId: stepInstance.id,
      ...(branch ? { branchInstanceId: branch.id } : {}),
      eventType: 'CONDITION_MET',
      eventData: { stepId: stepDef.stepId, attempts: 1, waitedMs: 0, wokenBy: 'immediate' },
      userId: context.userId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

    return {
      status: 'COMPLETED',
      outputData: {
        stepType: CONDITION_STEP_TYPE,
        conditionMet: true,
        attempts: 1,
        waitedMs: 0,
        wokenBy: 'immediate',
      },
    }
  }

  const deadlineAt = new Date(now.getTime() + config.timeoutMs)

  const { enqueueConditionCheckJob } = await import('./activity-executor')
  const jobId = await enqueueConditionCheckJob({
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    branchInstanceId: branch ? branch.id : undefined,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
    userId: context.userId,
    deadlineAt: deadlineAt.toISOString(),
    attempt: 1,
    delayMs: Math.min(config.pollIntervalMs, config.timeoutMs),
  })

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    ...(branch ? { branchInstanceId: branch.id } : {}),
    eventType: 'CONDITION_AWAITING',
    eventData: {
      stepId: stepDef.stepId,
      condition: config.condition,
      deadlineAt: deadlineAt.toISOString(),
      pollIntervalMs: config.pollIntervalMs,
      onTimeout: config.onTimeout,
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
    waitReason: 'CONDITION',
    outputData: {
      stepType: CONDITION_STEP_TYPE,
      deadlineAt: deadlineAt.toISOString(),
      pollIntervalMs: config.pollIntervalMs,
      onTimeout: config.onTimeout,
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
