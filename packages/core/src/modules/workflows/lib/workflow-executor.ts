/**
 * Workflows Module - Workflow Executor Service
 *
 * Main orchestrator for workflow execution. Handles workflow lifecycle:
 * - Starting workflow instances from definitions
 * - Executing workflow steps and transitions
 * - Completing workflows with final status
 * - Triggering compensation on failure
 *
 * Functional API (no classes) following Open Mercato conventions.
 */

import { EntityManager, LockMode } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowEvent,
  type WorkflowInstanceStatus,
  type WorkflowInstanceErrorHandlerMetadata,
} from '../data/entities'
import { compensateWorkflow } from './compensation-handler'
import { WORKFLOW_ENGINE_VERSION, isEngineVersionSupported } from './engine-version'
import {
  WORKFLOW_ERROR_CONTEXT_KEY,
  buildErrorContextEntry,
} from './error-routing'
import { excludeNonNormalTransitions } from './route-kinds'
import {
  WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY,
  readAgentOutcomeMarker,
  resolveAgentOutcomeHandling,
  type OutcomeRoutingDefinitionLike,
  type WorkflowAgentOutcomeContextEntry,
} from './outcome-routing'
import { scheduleWorkflowErrorHandler } from './error-handler'
import { resolveRunOutcome } from './run-outcome'
import { collectRunOutcomeEvidence } from './run-outcome-evidence'
import { findWorkflowDefinition, findDefinitionForInstance } from './find-definition'
import { resolveWorkflowDefinitionExecutionUserId } from './definition-grant'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitWorkflowsEvent } from '../events'
import { DRY_RUN_EVENT_TYPES } from './dry-run'
import {
  STEP_THROUGH_EVENT_TYPE,
  consumeStepThroughRelease,
  isStepThroughArmed,
  shouldPauseForStepThrough,
} from './step-through'
import type {
  WorkflowActivityJob,
  WorkflowActivityJobResumeSubWorkflowParent,
} from './activity-queue-types'

const logger = createLogger('workflows')

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface StartWorkflowOptions {
  workflowId: string
  version?: number // Default to latest enabled version
  initialContext?: Record<string, any>
  correlationKey?: string
  metadata?: {
    entityType?: string
    entityId?: string
    initiatedBy?: string
    labels?: Record<string, string>
    // Set by the workflow-level error handler when it starts a handler run, so
    // the depth guard travels with the child instance (spec 5.9).
    errorHandler?: WorkflowInstanceErrorHandlerMetadata | null
  }
  /**
   * Run this instance as a side-effect-free simulation (spec section 8.2).
   *
   * It is durable state on the row rather than a per-call argument because a
   * run outlives the call that started it: it parks on a signal, resumes from a
   * worker, is advanced by a task completion. Anything that only lived on this
   * options object would stop protecting the run the moment it suspended.
   */
  isDryRun?: boolean
  tenantId: string
  organizationId: string
}

export interface ExecutionContext {
  userId?: string
  /**
   * @deprecated Never read, and never was. Dry-run state lives on
   * `WorkflowInstance.isDryRun` (spec section 8.2) because a per-execution flag
   * cannot survive the instance parking on a signal and resuming inside a
   * worker — which is exactly when a leak would happen. Kept as an inert field
   * for one minor per `BACKWARD_COMPATIBILITY.md`; pass `isDryRun` to
   * `startWorkflow` instead.
   */
  dryRun?: boolean
  timeout?: number
}

export interface ExecutionResult {
  status: WorkflowInstanceStatus
  currentStep: string
  context: Record<string, any>
  events: WorkflowEventSummary[]
  errors?: string[]
  executionTime: number
}

export interface WorkflowEventSummary {
  eventType: string
  occurredAt: Date
  data?: any
}

function normalizeWorkflowUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('trigger:')) return null
  return trimmed
}

function resolveWorkflowExecutionUserId(
  context: ExecutionContext | undefined,
  instance: WorkflowInstance,
): string | undefined {
  return (
    normalizeWorkflowUserId(context?.userId) ??
    normalizeWorkflowUserId(instance.metadata?.initiatedBy) ??
    undefined
  )
}

/**
 * The identity this run advances under.
 *
 * A definition declaring `grantedFeatures` ALWAYS acts as its own least-
 * privilege principal, so a run started by an admin cannot silently gain the
 * admin's powers and an event-triggered run (which has no actor at all) gets a
 * real one. Everything else keeps the historic borrow-the-starting-user
 * behaviour, byte-for-byte.
 */
async function resolveRunActorUserId(
  em: EntityManager,
  definition: WorkflowDefinition,
  context: ExecutionContext | undefined,
  instance: WorkflowInstance,
): Promise<string | undefined> {
  const fallback = resolveWorkflowExecutionUserId(context, instance)
  const actor = await resolveWorkflowDefinitionExecutionUserId(
    em as unknown as PostgreSqlEntityManager,
    definition,
    fallback,
  )
  return actor ?? undefined
}

export class WorkflowExecutionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message)
    this.name = 'WorkflowExecutionError'
  }
}

// ============================================================================
// Main Orchestration Functions
// ============================================================================

/**
 * Start a new workflow instance from a definition
 *
 * @param em - Entity manager for database operations
 * @param options - Workflow start options
 * @returns Created workflow instance
 * @throws WorkflowExecutionError if definition not found or validation fails
 */
export async function startWorkflow(
  em: EntityManager,
  options: StartWorkflowOptions
): Promise<WorkflowInstance> {
  const {
    workflowId,
    version,
    initialContext = {},
    correlationKey,
    metadata,
    isDryRun = false,
    tenantId,
    organizationId,
  } = options

  // Find workflow definition
  const definition = await findWorkflowDefinition(em, {
    workflowId,
    version,
    tenantId,
    organizationId,
  })

  if (!definition) {
    throw new WorkflowExecutionError(
      `Workflow definition not found: ${workflowId}${version ? ` v${version}` : ''}`,
      'DEFINITION_NOT_FOUND',
      { workflowId, version }
    )
  }

  if (!definition.enabled) {
    throw new WorkflowExecutionError(
      `Workflow definition is disabled: ${workflowId}`,
      'DEFINITION_DISABLED',
      { workflowId, version: definition.version }
    )
  }

  // Forward-compatibility guard: a definition authored against a newer engine
  // is refused outright rather than executed with unknown step types treated
  // as no-ops (spec section 5.8).
  const minEngineVersion = definition.metadata?.minEngineVersion
  if (!isEngineVersionSupported(minEngineVersion)) {
    throw new WorkflowExecutionError(
      `Workflow definition requires engine version ${minEngineVersion}, this engine is version ${WORKFLOW_ENGINE_VERSION}`,
      'ENGINE_VERSION_TOO_OLD',
      { workflowId, version: definition.version, minEngineVersion, engineVersion: WORKFLOW_ENGINE_VERSION }
    )
  }

  // Validate definition has required steps
  const { steps, transitions } = definition.definition
  if (!steps || steps.length < 2) {
    throw new WorkflowExecutionError(
      'Workflow definition must have at least START and END steps',
      'INVALID_DEFINITION',
      { workflowId, stepsCount: steps?.length || 0 }
    )
  }

  if (!transitions || transitions.length < 1) {
    throw new WorkflowExecutionError(
      'Workflow definition must have at least one transition',
      'INVALID_DEFINITION',
      { workflowId, transitionsCount: transitions?.length || 0 }
    )
  }

  // Find START step
  const startStep = steps.find((s: any) => s.stepType === 'START')
  if (!startStep) {
    throw new WorkflowExecutionError(
      'Workflow definition must have a START step',
      'INVALID_DEFINITION',
      { workflowId }
    )
  }

  // Validate START step pre-conditions if defined
  if (startStep.preConditions && startStep.preConditions.length > 0) {
    const { validateWorkflowStart } = await import('./start-validator')

    const validationResult = await validateWorkflowStart(em, {
      workflowId,
      version: definition.version,
      context: initialContext,
      tenantId,
      organizationId,
    })

    if (!validationResult.canStart) {
      throw new WorkflowExecutionError(
        `Workflow start pre-conditions failed: ${validationResult.errors.map(e => e.message).join('; ')}`,
        'START_PRE_CONDITIONS_FAILED',
        {
          workflowId,
          errors: validationResult.errors,
          validatedRules: validationResult.validatedRules,
        }
      )
    }
  }

  // Create workflow instance
  const now = new Date()
  const instance = em.create(WorkflowInstance, {
    definitionId: definition.id,
    workflowId: definition.workflowId,
    version: definition.version,
    status: 'RUNNING',
    currentStepId: startStep.stepId,
    context: initialContext,
    correlationKey,
    metadata,
    startedAt: now,
    retryCount: 0,
    isDryRun,
    tenantId,
    organizationId,
    createdAt: now,
    updatedAt: now,
  })

  await em.persist(instance).flush()

  // Log WORKFLOW_STARTED event
  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: 'WORKFLOW_STARTED',
    eventData: {
      workflowId: instance.workflowId,
      version: instance.version,
      startStepId: startStep.stepId,
      initialContext,
      metadata,
    },
    userId: metadata?.initiatedBy,
    tenantId,
    organizationId,
  })

  if (isDryRun) {
    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      eventType: DRY_RUN_EVENT_TYPES.started,
      eventData: { workflowId: instance.workflowId, version: instance.version },
      userId: metadata?.initiatedBy,
      tenantId,
      organizationId,
    })
  }

  await emitInstanceLifecycleEvent(instance, 'workflows.instance.created')
  await emitInstanceLifecycleEvent(instance, 'workflows.instance.started')

  return instance
}

/**
 * Execute a workflow instance
 *
 * Main execution loop that processes steps and transitions until:
 * - Workflow completes (reaches END step)
 * - Workflow waits (USER_TASK, SIGNAL, TIMER)
 * - Workflow fails (error occurs)
 * - Timeout is reached
 *
 * @param em - Entity manager
 * @param container - DI container (for activity execution and other services)
 * @param instanceId - Workflow instance ID
 * @param context - Execution context (userId, dryRun, timeout)
 * @returns Execution result with status and events
 */
export async function executeWorkflow(
  em: EntityManager,
  container: AwilixContainer,
  instanceId: string,
  context?: ExecutionContext
): Promise<ExecutionResult> {
  const startTime = Date.now()
  const transactionalEm = em as EntityManager & {
    transactional?: <TResult>(
      callback: (trx: EntityManager) => Promise<TResult>,
    ) => Promise<TResult>
  }

  const runExecution = async (trx: EntityManager): Promise<ExecutionResult> => {
    const events: WorkflowEventSummary[] = []
    const errors: string[] = []

    try {
      const instance = await getWorkflowInstanceForExecution(trx, instanceId)
      if (!instance) {
        throw new WorkflowExecutionError(
          `Workflow instance not found: ${instanceId}`,
          'INSTANCE_NOT_FOUND',
          { instanceId }
        )
      }

      if (instance.status === 'COMPLETED') {
        return {
          status: 'COMPLETED',
          currentStep: instance.currentStepId,
          context: instance.context,
          events: [],
          executionTime: 0,
        }
      }

      if (instance.status === 'CANCELLED') {
        throw new WorkflowExecutionError(
          'Cannot execute cancelled workflow',
          'WORKFLOW_CANCELLED',
          { instanceId, status: instance.status }
        )
      }

      const definition = await findDefinitionForInstance(trx, instance)

      if (!definition) {
        throw new WorkflowExecutionError(
          `Workflow definition not found: ${instance.definitionId}`,
          'DEFINITION_NOT_FOUND',
          { definitionId: instance.definitionId }
        )
      }

      const maxIterations = 100
      let iterations = 0
      const executionUserId = await resolveRunActorUserId(trx, definition, context, instance)

      while (iterations < maxIterations) {
        iterations++

        const currentInstance = await getWorkflowInstanceForExecution(trx, instanceId, { refresh: iterations > 1 })
        if (!currentInstance) {
          throw new WorkflowExecutionError(
            'Instance not found during execution',
            'INSTANCE_NOT_FOUND',
            { instanceId }
          )
        }

        // Parallel execution: while the instance is FORKED, drive the branches.
        if (currentInstance.status === 'FORKED') {
          const { advanceBranches } = await import('./parallel-handler')
          const branchResult = await advanceBranches(trx, container, currentInstance, definition, {
            userId: executionUserId,
          })

          if (branchResult.outcome === 'joined') {
            // Instance resumed at the post-join step; continue single-token.
            continue
          }

          if (branchResult.outcome === 'failed') {
            errors.push(branchResult.error || 'Parallel branch failed')
            await completeWorkflow(trx, container, instanceId, 'FAILED', {
              error: branchResult.error || 'Parallel branch failed',
            })
            return {
              status: 'FAILED',
              currentStep: currentInstance.currentStepId,
              context: currentInstance.context,
              events,
              errors,
              executionTime: Date.now() - startTime,
            }
          }

          // 'waiting' — all branches paused for external resume (task/signal/timer/async).
          return {
            status: 'RUNNING',
            currentStep: currentInstance.currentStepId,
            context: currentInstance.context,
            events,
            executionTime: Date.now() - startTime,
          }
        }

        // Defense in depth: a prior step parked the instance (e.g. an
        // INVOKE_AGENT AUTOMATED step set PAUSED, or a transition set
        // WAITING_FOR_ACTIVITIES). Every resume path (sendSignal,
        // resumeWorkflowAfterActivities) flips status back to RUNNING before
        // re-entering, so a PAUSED/WAITING_FOR_ACTIVITIES status here means an
        // external completion is still pending — stop advancing.
        if (currentInstance.status === 'PAUSED' || currentInstance.status === 'WAITING_FOR_ACTIVITIES') {
          return {
            status: 'RUNNING',
            currentStep: currentInstance.currentStepId,
            context: currentInstance.context,
            events,
            executionTime: Date.now() - startTime,
          }
        }

        const currentStep = definition.definition.steps.find(
          (s: any) => s.stepId === currentInstance.currentStepId
        )

        // Step-through (spec section 8.2). An instance-level PAUSED between
        // steps — no new instance status and no new step status, so the state
        // machines are untouched. The marker is a RELEASE TOKEN for exactly one
        // step id, so replaying this loop after a crash cannot run a step the
        // author never released, and a double Continue cannot run two.
        if (
          shouldPauseForStepThrough(
            currentInstance,
            currentInstance.currentStepId,
            currentStep?.stepType
          )
        ) {
          await pauseForStepThrough(trx, currentInstance)
          events.push({
            eventType: STEP_THROUGH_EVENT_TYPE,
            occurredAt: new Date(),
            data: { stepId: currentInstance.currentStepId },
          })
          return {
            status: 'RUNNING',
            currentStep: currentInstance.currentStepId,
            context: currentInstance.context,
            events,
            executionTime: Date.now() - startTime,
          }
        }

        if (isStepThroughArmed(currentInstance)) {
          // The released step is about to run: burn the token now so the cursor
          // landing on the NEXT step pauses, whatever route it takes.
          currentInstance.metadata = {
            ...(currentInstance.metadata || {}),
            stepThrough: consumeStepThroughRelease(),
          }
          currentInstance.updatedAt = new Date()
          await trx.flush()
        }

        if (currentStep?.stepType === 'END') {
          await completeWorkflow(trx, container, instanceId, 'COMPLETED')
          events.push({
            eventType: 'WORKFLOW_COMPLETED',
            occurredAt: new Date(),
          })

          return {
            status: 'COMPLETED',
            currentStep: currentInstance.currentStepId,
            context: currentInstance.context,
            events,
            executionTime: Date.now() - startTime,
          }
        }

        if (
          currentStep?.stepType === 'USER_TASK' ||
          currentStep?.stepType === 'WAIT_FOR_SIGNAL' ||
          currentStep?.stepType === 'WAIT_FOR_TIMER'
        ) {
          return {
            status: 'RUNNING',
            currentStep: currentInstance.currentStepId,
            context: currentInstance.context,
            events,
            executionTime: Date.now() - startTime,
          }
        }

        // Outcome routing (spec 7.2). An agent step that resolved a disposition
        // leaves an engine-owned marker; a wired outcome route is followed
        // declaratively instead of via a condition matching a context string.
        // `default` — the marker's absence, or a step that wired no outcome at
        // all — falls straight through to the normal routing below, which is the
        // whole of the backward-compatibility guarantee.
        const outcomeMarker = readAgentOutcomeMarker(
          currentInstance.context,
          currentInstance.currentStepId ?? '',
        )
        if (outcomeMarker) {
          const dispatched = await dispatchAgentOutcome(
            trx,
            container,
            currentInstance,
            definition.definition,
            outcomeMarker,
            { workflowContext: currentInstance.context, userId: executionUserId },
          )
          if (dispatched.kind === 'routed') {
            events.push({
              eventType: 'OUTCOME_ROUTED',
              occurredAt: new Date(),
              data: {
                stepId: outcomeMarker.stepId,
                outcome: outcomeMarker.outcome,
                toStepId: dispatched.toStepId,
                transitionId: dispatched.transitionId,
              },
            })
            continue
          }
          if (dispatched.kind === 'failed') {
            errors.push(dispatched.error)
            events.push({
              eventType: 'OUTCOME_UNHANDLED',
              occurredAt: new Date(),
              data: { stepId: outcomeMarker.stepId, outcome: outcomeMarker.outcome },
            })
            await completeWorkflow(trx, container, instanceId, 'FAILED', { error: dispatched.error })
            return {
              status: 'FAILED',
              currentStep: currentInstance.currentStepId,
              context: currentInstance.context,
              events,
              errors,
              executionTime: Date.now() - startTime,
            }
          }
          if (dispatched.kind === 'parked') {
            return {
              status: 'RUNNING',
              currentStep: currentInstance.currentStepId,
              context: currentInstance.context,
              events,
              executionTime: Date.now() - startTime,
            }
          }
        }

        const transitions = excludeNonNormalTransitions(definition.definition.transitions).filter(
          (t: any) =>
            t.fromStepId === currentInstance.currentStepId &&
            t.trigger === 'auto'
        )

        if (transitions.length === 0) {
          return {
            status: 'RUNNING',
            currentStep: currentInstance.currentStepId,
            context: currentInstance.context,
            events,
            executionTime: Date.now() - startTime,
          }
        }

        const transitionHandler = await import('./transition-handler')
        const evalContext: any = {
          workflowContext: currentInstance.context,
          userId: executionUserId,
        }

        const validTransitions = await transitionHandler.findValidTransitions(
          trx,
          currentInstance,
          currentInstance.currentStepId!,
          evalContext
        )

        const validAutoTransitions = validTransitions.filter(
          (vt) => vt.isValid && vt.transition?.trigger === 'auto'
        )

        if (validAutoTransitions.length === 0) {
          return {
            status: 'RUNNING',
            currentStep: currentInstance.currentStepId,
            context: currentInstance.context,
            events,
            executionTime: Date.now() - startTime,
          }
        }

        const selectedTransition = validAutoTransitions[0].transition

        try {
          const transitionResult = await transitionHandler.executeTransition(
            trx,
            container,
            currentInstance,
            selectedTransition.fromStepId,
            selectedTransition.toStepId,
            { ...evalContext, transitionId: selectedTransition.transitionId },
          )

          if (!transitionResult.success) {
            const rejectionMessage = transitionResult.error || 'Transition failed'

            // Error routing (spec 5.9): a wired error route is followed instead
            // of failing the instance; a failure-queue directive parks it. Both
            // are absent unless the definition opts in, so the legacy failure
            // path below is byte-identical for every existing definition.
            if (transitionResult.errorRoute && transitionResult.failedStepId) {
              const routed = await followErrorRoute(
                trx,
                container,
                currentInstance,
                transitionResult.failedStepId,
                transitionResult.errorRoute,
                rejectionMessage,
                evalContext
              )
              if (routed) {
                events.push({
                  eventType: 'ERROR_ROUTED',
                  occurredAt: new Date(),
                  data: {
                    failedStepId: transitionResult.failedStepId,
                    toStepId: transitionResult.errorRoute.toStepId,
                    transitionId: transitionResult.errorRoute.transitionId,
                  },
                })
                continue
              }
              errors.push(`Error route from ${transitionResult.failedStepId} could not be followed`)
            }

            if (transitionResult.errorHandlerStepId && transitionResult.failedStepId) {
              const entered = await enterErrorHandlerStep(
                trx,
                container,
                currentInstance,
                transitionResult.failedStepId,
                transitionResult.errorHandlerStepId,
                rejectionMessage,
                executionUserId
              )
              if (entered) {
                events.push({
                  eventType: 'ERROR_HANDLER_STARTED',
                  occurredAt: new Date(),
                  data: {
                    failedStepId: transitionResult.failedStepId,
                    handlerStepId: transitionResult.errorHandlerStepId,
                  },
                })
                continue
              }
              errors.push(
                `Error handler step ${transitionResult.errorHandlerStepId} could not be entered`
              )
            }

            if (transitionResult.parkForAttention && transitionResult.failedStepId) {
              await parkInstanceForAttention(
                trx,
                currentInstance,
                transitionResult.failedStepId,
                rejectionMessage
              )
              events.push({
                eventType: 'ERROR_PARKED',
                occurredAt: new Date(),
                data: { failedStepId: transitionResult.failedStepId },
              })
              return {
                status: 'RUNNING',
                currentStep: currentInstance.currentStepId,
                context: currentInstance.context,
                events,
                executionTime: Date.now() - startTime,
              }
            }

            logger.error('Transition rejected', {
              instanceId: currentInstance.id,
              workflowId: currentInstance.workflowId,
              fromStepId: currentInstance.currentStepId,
              toStepId: selectedTransition.toStepId,
              err: rejectionMessage,
            })
            errors.push(rejectionMessage)

            await completeWorkflow(trx, container, instanceId, 'FAILED', {
              error: rejectionMessage,
            })
            events.push({
              eventType: 'WORKFLOW_FAILED',
              occurredAt: new Date(),
            })

            return {
              status: 'FAILED',
              currentStep: currentInstance.currentStepId,
              context: currentInstance.context,
              events,
              errors,
              executionTime: Date.now() - startTime,
            }
          }

          events.push({
            eventType: 'TRANSITION_EXECUTED',
            occurredAt: new Date(),
            data: {
              fromStepId: selectedTransition.fromStepId,
              toStepId: selectedTransition.toStepId,
              transitionId: selectedTransition.transitionId,
            },
          })

          // Spec 2026-06-26: step/stage advances re-emit `started` with the
          // destination stepId so projections can track stage transitions.
          await emitInstanceLifecycleEvent(currentInstance, 'workflows.instance.started', {
            stepId: selectedTransition.toStepId,
            fromStepId: selectedTransition.fromStepId,
          })

          if (transitionResult.pausedForActivities) {
            await logWorkflowEvent(trx, {
              workflowInstanceId: currentInstance.id,
              eventType: 'WORKFLOW_WAITING_FOR_ACTIVITIES',
              eventData: {
                pendingActivities: transitionResult.activitiesExecuted?.filter(a => a.async),
                pausedAtTransition: {
                  fromStepId: selectedTransition.fromStepId,
                  toStepId: selectedTransition.toStepId,
                },
              },
              tenantId: currentInstance.tenantId,
              organizationId: currentInstance.organizationId,
            })

            events.push({
              eventType: 'WORKFLOW_WAITING_FOR_ACTIVITIES',
              occurredAt: new Date(),
              data: {
                pendingActivities: transitionResult.activitiesExecuted?.filter(a => a.async),
              },
            })

            return {
              status: 'WAITING_FOR_ACTIVITIES',
              currentStep: currentInstance.currentStepId,
              context: currentInstance.context,
              events,
              executionTime: Date.now() - startTime,
            }
          }

          // The transition succeeded but the destination step parked the
          // instance (e.g. an INVOKE_AGENT AUTOMATED step enqueued an async
          // agent job and set PAUSED). The token cursor has already advanced to
          // that parked step, so currentInstance.currentStepId is the parked
          // step. Stop advancing until an external signal resumes it.
          if (transitionResult.paused) {
            return {
              status: 'RUNNING',
              currentStep: currentInstance.currentStepId,
              context: currentInstance.context,
              events,
              executionTime: Date.now() - startTime,
            }
          }

          await trx.flush()
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          logger.error('Transition execution failed', {
            instanceId: currentInstance.id,
            workflowId: currentInstance.workflowId,
            fromStepId: currentInstance.currentStepId,
            toStepId: selectedTransition.toStepId,
            err: error,
          })
          errors.push(errorMessage)

          events.push({
            eventType: 'TRANSITION_FAILED',
            occurredAt: new Date(),
            data: {
              transitionId: selectedTransition.transitionId,
              error: errorMessage,
            },
          })

          await completeWorkflow(trx, container, instanceId, 'FAILED', {
            error: errorMessage,
            details: error instanceof WorkflowExecutionError ? error.details : undefined,
          })
          events.push({
            eventType: 'WORKFLOW_FAILED',
            occurredAt: new Date(),
          })

          return {
            status: 'FAILED',
            currentStep: currentInstance.currentStepId,
            context: currentInstance.context,
            events,
            errors,
            executionTime: Date.now() - startTime,
          }
        }
      }

      errors.push('Maximum execution iterations reached - possible infinite loop')
      return {
        status: 'RUNNING',
        currentStep: instance.currentStepId,
        context: instance.context,
        events,
        errors,
        executionTime: Date.now() - startTime,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Execution failed', { instanceId, err: error })
      errors.push(errorMessage)

      try {
        const instance = await getWorkflowInstanceForExecution(trx, instanceId, { refresh: true })
        if (instance && instance.status === 'RUNNING') {
          instance.status = 'FAILED'
          instance.errorMessage = errorMessage
          instance.errorDetails = error instanceof WorkflowExecutionError ? error.details : undefined
          instance.updatedAt = new Date()
          await writeRunOutcome(trx, instance, 'FAILED')
          await trx.flush()

          await logWorkflowEvent(trx, {
            workflowInstanceId: instanceId,
            eventType: 'WORKFLOW_FAILED',
            eventData: { error: errorMessage },
            tenantId: instance.tenantId,
            organizationId: instance.organizationId,
          })
        }
      } catch (updateError) {
        logger.error('Failed to update instance with error state', { instanceId, err: updateError })
      }

      throw error
    }
  }

  if (typeof transactionalEm.transactional !== 'function') {
    return runExecution(em)
  }

  try {
    return await transactionalEm.transactional((trx) => runExecution(trx))
  } catch (error) {
    // The throw has rolled back the execution transaction, discarding the
    // in-transaction FAILED write (and every step/bookkeeping advance) — which
    // would otherwise leave the instance silently stuck at RUNNING/start (#3632).
    // The in-transaction FAILED write is also futile when the underlying error
    // aborted the Postgres transaction (e.g. an effector issuing bad SQL): every
    // subsequent write on that connection fails. Now that the transaction — and
    // its PESSIMISTIC_WRITE lock on the instance row — has been released, durably
    // persist FAILED on an independent fork so the failure is visible and
    // retryable. Restores the #2593 "persist FAILED" guarantee even when the
    // whole transaction is discarded. Best-effort: never masks the original error.
    await persistFailedStatusAfterRollback(em, instanceId, error)
    throw error
  }
}

export type AgentOutcomeDispatch =
  | { kind: 'routed'; toStepId: string; transitionId?: string; paused?: boolean }
  | { kind: 'parked' }
  | { kind: 'failed'; error: string }
  | { kind: 'default' }

/**
 * Dispatch a resolved agent disposition for whatever step the instance is
 * currently on, or return null when there is no marker to act on.
 *
 * Exported because `sendSignal` advances a resumed instance ITSELF — it picks
 * the next transition and executes it before handing back to the executor — so
 * an outcome route wired on a parked agent step has to be honoured there too.
 * Routing it in only one of the two places is how a disposition silently takes
 * the happy path on the human-dispose path while working on the inline one.
 */
export async function dispatchAgentOutcomeForCurrentStep(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  definition: OutcomeRoutingDefinitionLike,
  evalContext: { workflowContext: Record<string, unknown>; userId?: string }
): Promise<AgentOutcomeDispatch | null> {
  const marker = readAgentOutcomeMarker(instance.context, instance.currentStepId ?? '')
  if (!marker) return null
  return await dispatchAgentOutcome(em, container, instance, definition, marker, evalContext)
}

/**
 * Act on a resolved agent disposition (spec 7.2).
 *
 * The engine-owned marker is consumed here — cleared before anything else runs —
 * so a route that loops back through the same step cannot re-fire on the old
 * disposition, and so a `default` outcome leaves no residue in the run context.
 *
 * `default` means "route exactly as this instance always would have": the step
 * wired no outcome at all, or the outcome is `approved`, which §7.2 renders as
 * the node's ordinary output. Only a step that opted into outcome routing can
 * reach the inheritance branch, which is what keeps this additive.
 */
async function dispatchAgentOutcome(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  definition: OutcomeRoutingDefinitionLike,
  marker: WorkflowAgentOutcomeContextEntry,
  evalContext: { workflowContext: Record<string, unknown>; userId?: string }
): Promise<AgentOutcomeDispatch> {
  const { [WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]: _consumed, ...remainingContext } =
    (instance.context || {}) as Record<string, unknown>
  instance.context = remainingContext
  instance.updatedAt = new Date()
  await em.flush()

  const clearedEvalContext = {
    ...evalContext,
    workflowContext: remainingContext,
  }

  const failUnhandled = async (error: string): Promise<AgentOutcomeDispatch> => {
    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      eventType: 'OUTCOME_UNHANDLED',
      eventData: { stepId: marker.stepId, outcome: marker.outcome, error },
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })
    return { kind: 'failed', error }
  }

  const handling = resolveAgentOutcomeHandling(definition, marker.stepId, marker.outcome)
  if (handling.kind === 'default') return { kind: 'default' }

  if (handling.kind === 'route') {
    const toStepId = handling.transition.toStepId
    if (!toStepId) return { kind: 'default' }

    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      eventType: 'OUTCOME_ROUTED',
      eventData: {
        stepId: marker.stepId,
        outcome: marker.outcome,
        toStepId,
        transitionId: handling.transition.transitionId,
        proposalId: marker.proposalId,
      },
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

    const transitionHandler = await import('./transition-handler')
    const routed = await transitionHandler.executeTransition(
      em,
      container,
      instance,
      marker.stepId,
      toStepId,
      { ...clearedEvalContext, transitionId: handling.transition.transitionId },
    )
    if (routed.success) {
      return {
        kind: 'routed',
        toStepId,
        transitionId: handling.transition.transitionId,
        paused: routed.paused,
      }
    }
    return await failUnhandled(`Outcome route for "${marker.outcome}" could not be followed`)
  }

  // `inherit`: an unwired non-approved outcome follows the complete step-error
  // handling contract, including continuation, failure-queue parking and the
  // definition-level handler step.
  const unhandled = `Agent step ${marker.stepId} resolved outcome "${marker.outcome}", which is not wired`
  if (handling.handling.kind === 'route') {
    const errorRoute = handling.handling.transition
    if (errorRoute.toStepId) {
      const routed = await followErrorRoute(
        em,
        container,
        instance,
        marker.stepId,
        { transitionId: errorRoute.transitionId, toStepId: errorRoute.toStepId },
        unhandled,
        clearedEvalContext
      )
      if (routed) {
        return {
          kind: 'routed',
          toStepId: errorRoute.toStepId,
          transitionId: errorRoute.transitionId,
          paused: instance.status === 'PAUSED',
        }
      }
    }
  }

  if (handling.handling.kind === 'continue') {
    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      eventType: 'ERROR_DIRECTIVE_APPLIED',
      eventData: {
        stepId: marker.stepId,
        directive: 'continueWithFallback',
        source: 'agentOutcome',
        hasFallbackValue: handling.handling.fallbackValue !== undefined,
      },
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })
    if (handling.handling.fallbackValue !== undefined) {
      instance.context = {
        ...(instance.context || {}),
        [marker.stepId]: handling.handling.fallbackValue,
      }
      instance.updatedAt = new Date()
      await em.flush()
    }
    return { kind: 'default' }
  }

  if (handling.handling.kind === 'park') {
    await parkInstanceForAttention(em, instance, marker.stepId, unhandled)
    return { kind: 'parked' }
  }

  if (handling.handling.kind === 'handlerStep') {
    const entered = await enterErrorHandlerStep(
      em,
      container,
      instance,
      marker.stepId,
      handling.handling.stepId,
      unhandled,
      clearedEvalContext.userId,
    )
    if (entered) {
      return {
        kind: 'routed',
        toStepId: handling.handling.stepId,
        paused: instance.status === 'PAUSED',
      }
    }
  }

  return await failUnhandled(unhandled)
}

/**
 * Follow a wired error route out of a failed step (spec 5.9). The failure is
 * published into the run context under `__error` so the handling branch can act
 * on it, then the error transition executes through the normal machinery — it
 * creates its step instance, runs its activities and logs its events like any
 * other route. Returns false when the route could not be taken, so the caller
 * falls back to the untouched failure path.
 */
async function followErrorRoute(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  failedStepId: string,
  errorRoute: { transitionId?: string; toStepId: string },
  error: string,
  evalContext: { workflowContext: Record<string, any>; userId?: string }
): Promise<boolean> {
  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: 'ERROR_ROUTED',
    eventData: {
      failedStepId,
      toStepId: errorRoute.toStepId,
      transitionId: errorRoute.transitionId,
      error,
    },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  const errorEntry = buildErrorContextEntry(failedStepId, error)
  instance.context = {
    ...(instance.context || {}),
    [WORKFLOW_ERROR_CONTEXT_KEY]: errorEntry,
  }
  instance.updatedAt = new Date()
  await em.flush()

  const transitionHandler = await import('./transition-handler')
  const routedResult = await transitionHandler.executeTransition(
    em,
    container,
    instance,
    failedStepId,
    errorRoute.toStepId,
    {
      ...evalContext,
      workflowContext: {
        ...evalContext.workflowContext,
        [WORKFLOW_ERROR_CONTEXT_KEY]: errorEntry,
      },
      transitionId: errorRoute.transitionId,
    },
  )

  return routedResult.success === true
}

/**
 * Enter the definition-level handler STEP (spec 5.9, `errorHandler.stepId`) for
 * a failure no route and no directive handled. The token jumps to the handler
 * step and executes it — the same cursor-move-plus-`executeStep` shape the
 * branch/timer/signal resumes already use, so no transition record is invented.
 * A failure of the handler step itself resolves to `fail` (the resolver never
 * jumps a step to itself), which is this form's recursion guard.
 */
async function enterErrorHandlerStep(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  failedStepId: string,
  handlerStepId: string,
  error: string,
  userId?: string
): Promise<boolean> {
  const errorEntry = buildErrorContextEntry(failedStepId, error)

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: 'ERROR_HANDLER_STARTED',
    eventData: { failedStepId, handlerStepId, error },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  instance.context = {
    ...(instance.context || {}),
    [WORKFLOW_ERROR_CONTEXT_KEY]: errorEntry,
  }
  instance.currentStepId = handlerStepId
  instance.updatedAt = new Date()
  await em.flush()

  const { executeStep } = await import('./step-handler')
  const result = await executeStep(
    em,
    instance,
    handlerStepId,
    {
      workflowContext: {
        ...(instance.context || {}),
        [WORKFLOW_ERROR_CONTEXT_KEY]: errorEntry,
      },
      userId,
    },
    container
  )

  return result.status !== 'FAILED'
}

/**
 * Park a step-through run before the step the author has not released yet.
 *
 * Reuses PAUSED exactly as the failure queue does, and deliberately writes NO
 * `attention` marker: the run is waiting for the author, not for triage, so it
 * must not appear in the failure queue.
 */
async function pauseForStepThrough(
  em: EntityManager,
  instance: WorkflowInstance
): Promise<void> {
  const now = new Date()
  instance.status = 'PAUSED'
  instance.pausedAt = now
  instance.updatedAt = now
  await em.flush()

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: STEP_THROUGH_EVENT_TYPE,
    eventData: { stepId: instance.currentStepId },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })
}

/**
 * Park an instance for triage instead of failing it — the `failureQueue` error
 * directive (spec 5.9 "Send to failure queue"). Uses the existing PAUSED state
 * plus an engine-owned `metadata.attention` marker; no new instance status and
 * no compensation, because the run is suspended rather than terminated.
 */
async function parkInstanceForAttention(
  em: EntityManager,
  instance: WorkflowInstance,
  failedStepId: string,
  error: string
): Promise<void> {
  const now = new Date()
  instance.status = 'PAUSED'
  instance.pausedAt = now
  instance.errorMessage = error
  instance.metadata = {
    ...(instance.metadata || {}),
    attention: {
      reason: 'ERROR_DIRECTIVE',
      stepId: failedStepId,
      error,
      at: now.toISOString(),
    },
  }
  instance.updatedAt = now
  await em.flush()

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: 'ERROR_PARKED',
    eventData: { failedStepId, error, directive: 'failureQueue' },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })
}

/**
 * Durably mark a workflow instance FAILED after its execution transaction has
 * rolled back. MUST run on a fresh fork (a clean connection): the rolled-back
 * transaction may be aborted/poisoned, and its PESSIMISTIC_WRITE lock on the
 * instance row is released only once the transactional callback unwinds, so an
 * in-transaction write here would be discarded or deadlock. Only transitions a
 * still-`RUNNING` instance (leaves CANCELLED/COMPLETED/PAUSED untouched).
 */
async function persistFailedStatusAfterRollback(
  em: EntityManager,
  instanceId: string,
  error: unknown,
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorDetails = error instanceof WorkflowExecutionError ? error.details : undefined
  const markFailed = async (trx: EntityManager): Promise<void> => {
    const instance = await trx.findOne(
      WorkflowInstance,
      { id: instanceId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    )
    if (!instance || instance.status !== 'RUNNING') return
    instance.status = 'FAILED'
    instance.errorMessage = errorMessage
    instance.errorDetails = errorDetails
    instance.updatedAt = new Date()
    await writeRunOutcome(trx, instance, 'FAILED')
    await trx.flush()
    await logWorkflowEvent(trx, {
      workflowInstanceId: instanceId,
      eventType: 'WORKFLOW_FAILED',
      eventData: { error: errorMessage },
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })
    await emitInstanceLifecycleEvent(instance, 'workflows.instance.failed')
  }
  try {
    if (typeof (em as { fork?: unknown }).fork !== 'function') return
    const fork = em.fork() as EntityManager & {
      transactional?: <TResult>(callback: (trx: EntityManager) => Promise<TResult>) => Promise<TResult>
    }
    if (typeof fork.transactional === 'function') {
      await fork.transactional((trx) => markFailed(trx))
    } else {
      await markFailed(fork)
    }
  } catch (persistError) {
    console.error(
      `[WORKFLOW] Failed to durably persist FAILED status for instance ${instanceId} after rollback:`,
      persistError,
    )
  }
}

/**
 * Write the run's terminal VERDICT onto the instance, and guarantee it has a
 * terminal timestamp.
 *
 * The ONE write site, so `outcome` cannot be assembled ad hoc per exit point:
 * every caller hands over the terminal status and the pure
 * `resolveRunOutcome` decides from the evidence the run recorded. Called before
 * the flush that persists the terminal status, so status and verdict land in the
 * same UPDATE and no reader can observe one without the other.
 *
 * The timestamp backstop closes a real gap. `compensation-handler` flips the
 * status to COMPENSATED (or back to FAILED on a partial compensation) and
 * `completeWorkflow` RETURNS before its own `completedAt` assignment on that
 * path, so a compensated run had no terminal instant at all — it could be
 * attributed to no KPI window and its duration was unmeasurable. Every other
 * path already assigns one, so this only ever fills a hole; it never moves an
 * instant that was already recorded, and CANCELLED is excluded because
 * `cancelledAt` is its terminal instant.
 */
async function writeRunOutcome(
  em: EntityManager,
  instance: WorkflowInstance,
  terminalStatus: string,
): Promise<void> {
  const evidence = await collectRunOutcomeEvidence(em, instance, terminalStatus)
  instance.outcome = resolveRunOutcome(evidence)

  if (terminalStatus !== 'CANCELLED' && !instance.completedAt) {
    instance.completedAt = new Date()
  }
}

/**
 * Complete a workflow instance with final status
 *
 * @param em - Entity manager
 * @param container
 * @param instanceId - Workflow instance ID
 * @param status - Final status (COMPLETED, FAILED, CANCELLED)
 * @param result - Optional result data
 */
export async function completeWorkflow(
  em: EntityManager,
  container: AwilixContainer,
  instanceId: string,
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED',
  result?: any
): Promise<void> {
  const instance = await getWorkflowInstance(em, instanceId)
  if (!instance) {
    throw new WorkflowExecutionError(
      `Workflow instance not found: ${instanceId}`,
      'INSTANCE_NOT_FOUND',
      { instanceId }
    )
  }

  // Workflow-level error handler (spec 5.9) — scheduled BEFORE compensation so
  // the handler observes the state that failed rather than the rolled-back one,
  // and so it still runs when compensation throws (that block swallows errors
  // and returns early). Executed out of band by the worker; the
  // ERROR_HANDLER_SCHEDULED event is written here, inside this transaction.
  if (status === 'FAILED') {
    await scheduleWorkflowErrorHandler(em, instance, {
      failedStepId: result?.failedStepId ?? instance.currentStepId,
      error: result?.error,
      details: result?.details,
    })
  }

  // Trigger compensation if workflow failed and has compensatable activities (Phase 8.2)
  if (status === 'FAILED') {
    const definition = await findDefinitionForInstance(em, instance)

    if (definition && checkIfCompensationNeeded(definition)) {
      try {

        // Set error message before compensation
        if (result?.error) {
          instance.errorMessage = result.error
          instance.errorDetails = result.details
          await em.flush()
        }

        const compensationResult = await compensateWorkflow(
          em,
          container,
          instance,
          definition,
          {
            continueOnError: true // Best-effort compensation
          }
        )

        logger.info('Compensation finished', {
          status: compensationResult.status,
          compensatedActivities: compensationResult.compensatedActivities,
          totalActivities: compensationResult.totalActivities,
        })

        // Note: instance status already updated by compensateWorkflow
        // It will be COMPENSATED or remain FAILED. This branch RETURNS, so the
        // verdict is written here rather than at the shared tail below — same
        // resolver, same evidence, one more call site than the ideal one.
        await writeRunOutcome(em, instance, instance.status)
        await em.flush()

        // A compensated/failed child must still resume its parent SUB_WORKFLOW
        // step — otherwise a parent parked on this child stays PAUSED forever.
        // From the parent's perspective the sub-workflow did not succeed, so this
        // mirrors the normal-path enqueue below but always signals FAILED.
        await enqueueSubWorkflowParentResume(instance, 'FAILED')
        // Terminal signal for external projections: the run did not succeed,
        // regardless of whether compensation left it COMPENSATED or FAILED
        // (payload `status` carries the actual post-compensation status).
        await emitInstanceLifecycleEvent(instance, 'workflows.instance.failed')
        return
      } catch (error: any) {
        logger.error('Compensation failed with exception', { err: error })
        // Continue to mark workflow as failed
      }
    }
  }

  // Original completion logic (no compensation needed or status is COMPLETED/CANCELLED)
  const now = new Date()
  instance.status = status
  instance.updatedAt = now

  switch (status) {
    case 'COMPLETED':
      instance.completedAt = now
      if (result) {
        instance.context = { ...instance.context, __result: result }
      }
      break

    case 'FAILED':
      instance.completedAt = now
      if (result?.error) {
        instance.errorMessage = result.error
        instance.errorDetails = result.details
      }
      break

    case 'CANCELLED':
      instance.cancelledAt = now
      break
  }

  await writeRunOutcome(em, instance, status)

  await em.flush()

  // Log completion event
  const eventType =
    status === 'COMPLETED'
      ? 'WORKFLOW_COMPLETED'
      : status === 'FAILED'
        ? 'WORKFLOW_FAILED'
        : 'WORKFLOW_CANCELLED'

  await logWorkflowEvent(em, {
    workflowInstanceId: instanceId,
    eventType,
    eventData: result || {},
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  await emitInstanceLifecycleEvent(
    instance,
    status === 'COMPLETED'
      ? 'workflows.instance.completed'
      : status === 'FAILED'
        ? 'workflows.instance.failed'
        : 'workflows.instance.cancelled'
  )

  // If this instance is a child of a parked SUB_WORKFLOW step, enqueue a job to
  // resume the parent on the worker's own connection (never inline inside the
  // child's transaction — lock-ordering hazard). The worker guard skips the job
  // when the parent never parked (fully-synchronous fast path).
  if (status === 'COMPLETED' || status === 'FAILED') {
    await enqueueSubWorkflowParentResume(instance, status)
  }
}

/**
 * Enqueue a `resume_subworkflow_parent` job when a terminating instance carries a
 * parent linkage. Best-effort: a queue hiccup must not undo the just-persisted
 * terminal status, so failures are logged rather than thrown. The small delay
 * lets the parent's PAUSED flush become visible before the worker runs.
 */
async function enqueueSubWorkflowParentResume(
  instance: WorkflowInstance,
  childStatus: 'COMPLETED' | 'FAILED'
): Promise<void> {
  const labels = instance.metadata?.labels
  const parentInstanceId = labels?.parentInstanceId
  const parentStepId = labels?.parentStepId
  const parentStepInstanceId = labels?.parentStepInstanceId
  if (!parentInstanceId || !parentStepId || !parentStepInstanceId) return

  try {
    const { createModuleQueue } = await import('@open-mercato/queue')
    const { WORKFLOW_ACTIVITIES_QUEUE_NAME } = await import('./activity-queue-types')
    const { INVOKE_AGENT_ENQUEUE_DELAY_MS } = await import('./activity-executor')

    const queue = createModuleQueue<WorkflowActivityJob>(WORKFLOW_ACTIVITIES_QUEUE_NAME, {
      concurrency: parseInt(process.env.WORKFLOW_WORKER_CONCURRENCY || '5'),
    })

    const job: WorkflowActivityJobResumeSubWorkflowParent = {
      kind: 'resume_subworkflow_parent',
      workflowInstanceId: parentInstanceId,
      parentInstanceId,
      parentStepId,
      parentStepInstanceId,
      childInstanceId: instance.id,
      childStatus,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    }
    await queue.enqueue(job, { delayMs: INVOKE_AGENT_ENQUEUE_DELAY_MS })
  } catch (error) {
    console.error(
      `[WORKFLOW] Failed to enqueue parent-resume job for child ${instance.id} → parent ${parentInstanceId}:`,
      error instanceof Error ? error.message : error
    )
  }
}

/**
 * Resume workflow after async activities complete
 *
 * Called by the activity worker after all async activities finish execution.
 * Checks if all activities are done, merges outputs into context, and resumes execution.
 *
 * @param em - Entity manager
 * @param container - DI container
 * @param instanceId - Workflow instance ID
 */
export async function resumeWorkflowAfterActivities(
  em: EntityManager,
  container: AwilixContainer,
  instanceId: string,
  branchInstanceId?: string | null
): Promise<void> {
  const transactionalEm = em as EntityManager & {
    transactional?: <TResult>(callback: (trx: EntityManager) => Promise<TResult>) => Promise<TResult>
  }

  // Branch-scoped async resume: the instance is FORKED and the branch (not the
  // instance) is WAITING_FOR_ACTIVITIES. Resume just that branch, then let the
  // interleaved loop continue. Missing branchInstanceId → legacy instance path.
  if (branchInstanceId) {
    const { resumeBranchAfterActivities } = await import('./parallel-handler')
    const branchResume = typeof transactionalEm.transactional === 'function'
      ? await transactionalEm.transactional((trx) => resumeBranchAfterActivities(trx, container, instanceId, branchInstanceId))
      : await resumeBranchAfterActivities(em, container, instanceId, branchInstanceId)
    if (branchResume.continueExecution) {
      await executeWorkflow(em, container, instanceId)
    }
    return
  }

  const runResume = async (trx: EntityManager): Promise<{ continueExecution: boolean }> => {
    const instance = await trx.findOne(WorkflowInstance, {
      id: instanceId,
      status: 'WAITING_FOR_ACTIVITIES',
    }, { lockMode: LockMode.PESSIMISTIC_WRITE })

    if (!instance) {
      throw new Error('Workflow instance not waiting for activities')
    }

    const pendingJobIds = (instance.context._pendingAsyncActivities as any[]) || []

    const completedActivities = await trx.count(WorkflowEvent, {
      workflowInstanceId: instanceId,
      eventType: 'ACTIVITY_COMPLETED',
      eventData: { async: true },
    })

    const failedActivities = await trx.count(WorkflowEvent, {
      workflowInstanceId: instanceId,
      eventType: 'ACTIVITY_FAILED',
      eventData: { async: true },
    })

    const totalProcessed = completedActivities + failedActivities

    if (totalProcessed < pendingJobIds.length) {
      throw new Error('Activities still pending')
    }

    if (failedActivities > 0) {
      const failedEvents = await trx.find(WorkflowEvent, {
        workflowInstanceId: instanceId,
        eventType: 'ACTIVITY_FAILED',
        eventData: { async: true },
      })

      instance.status = 'FAILED'
      instance.errorMessage = `${failedActivities} async activities failed`
      instance.errorDetails = {
        failedActivities: failedEvents.map(e => ({
          activityId: e.eventData.activityId,
          error: e.eventData.error,
          jobId: e.eventData.jobId,
        })),
      }
      await writeRunOutcome(trx, instance, 'FAILED')
      await trx.flush()

      await logWorkflowEvent(trx, {
        workflowInstanceId: instanceId,
        eventType: 'WORKFLOW_FAILED',
        eventData: {
          reason: 'Async activities failed',
          failedActivities: instance.errorDetails.failedActivities,
        },
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
      })

      return { continueExecution: false }
    }

    const completedEvents = await trx.find(WorkflowEvent, {
      workflowInstanceId: instanceId,
      eventType: 'ACTIVITY_COMPLETED',
      eventData: { async: true },
    })

    for (const event of completedEvents) {
      if (event.eventData.output) {
        instance.context = {
          ...instance.context,
          [`${event.eventData.activityId}_result`]: event.eventData.output,
        }
      }
    }

    delete instance.context._pendingAsyncActivities

    const pendingTransition = instance.pendingTransition

    if (!pendingTransition) {
      logger.warn('No pending transition found during resume')
      instance.status = 'RUNNING'
      await trx.flush()

      await logWorkflowEvent(trx, {
        workflowInstanceId: instanceId,
        eventType: 'WORKFLOW_RESUMED',
        eventData: {
          reason: 'All async activities completed',
          completedActivities: completedActivities,
        },
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
      })

      return { continueExecution: true }
    }

    logger.debug('Completing pending transition', {
      toStepId: pendingTransition.toStepId,
      fromStepId: instance.currentStepId,
    })

    const definition = await findDefinitionForInstance(trx, instance)
    if (!definition) {
      throw new WorkflowExecutionError(
        `Workflow definition not found: ${instance.definitionId}`,
        'DEFINITION_NOT_FOUND',
        { definitionId: instance.definitionId }
      )
    }

    const step = definition.definition.steps.find(s => s.stepId === pendingTransition.toStepId)

    instance.currentStepId = pendingTransition.toStepId
    instance.status = 'RUNNING'
    instance.pendingTransition = null
    instance.updatedAt = new Date()
    await trx.flush()

    await logWorkflowEvent(trx, {
      workflowInstanceId: instance.id,
      eventType: 'STEP_ENTERED',
      eventData: {
        stepId: pendingTransition.toStepId,
        stepName: step?.stepName,
        stepType: step?.stepType,
      },
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

    await logWorkflowEvent(trx, {
      workflowInstanceId: instanceId,
      eventType: 'WORKFLOW_RESUMED',
      eventData: {
        reason: 'Async activities completed, resuming pending transition',
        completedActivities: completedActivities,
        completedTransitionTo: pendingTransition.toStepId,
      },
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

    // The async-resume path runs inside a worker, so it re-resolves the actor
    // from the definition exactly as the main loop does — otherwise a granted
    // workflow would revert to the starting user's identity the moment one of
    // its activities went async.
    const resumeDefinition = await findDefinitionForInstance(trx, instance)
    const { executeStep } = await import('./step-handler')
    await executeStep(
      trx,
      instance,
      pendingTransition.toStepId,
      {
        workflowContext: instance.context || {},
        userId: resumeDefinition
          ? await resolveRunActorUserId(trx, resumeDefinition, undefined, instance)
          : resolveWorkflowExecutionUserId(undefined, instance),
      },
      container
    )

    return { continueExecution: true }
  }

  const resumeResult = typeof transactionalEm.transactional === 'function'
    ? await transactionalEm.transactional((trx) => runResume(trx))
    : await runResume(em)

  if (resumeResult.continueExecution) {
    await executeWorkflow(em, container, instanceId)
  }
}

/**
 * Check if workflow definition has any compensatable activities
 */
function checkIfCompensationNeeded(definition: WorkflowDefinition): boolean {
  // Check if any activities have compensation defined
  for (const transition of definition.definition.transitions) {
    if (transition.activities) {
      for (const activity of transition.activities) {
        if (activity.compensation?.activityId) {
          return true
        }
      }
    }
  }

  // Check root-level activities (legacy)
  if (definition.definition.activities) {
    for (const activity of definition.definition.activities) {
      if (activity.compensation?.activityId) {
        return true
      }
    }
  }

  return false
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get workflow instance by ID.
 *
 * SECURITY: this helper is NOT tenant-scoped. It is an internal lookup whose
 * callers are expected to have resolved and enforced the scope already. Never
 * reach it directly from an HTTP handler — use a scoped query (see
 * `updateWorkflowContextScoped`) so a cross-tenant id cannot resolve.
 *
 * @param em - Entity manager
 * @param instanceId - Workflow instance ID
 * @returns Workflow instance or null if not found
 */
export async function getWorkflowInstance(
  em: EntityManager,
  instanceId: string
): Promise<WorkflowInstance | null> {
  return em.findOne(WorkflowInstance, { id: instanceId })
}

async function getWorkflowInstanceForExecution(
  em: EntityManager,
  instanceId: string,
  options?: { refresh?: boolean }
): Promise<WorkflowInstance | null> {
  return em.findOne(
    WorkflowInstance,
    { id: instanceId },
    {
      lockMode: LockMode.PESSIMISTIC_WRITE,
      ...(options?.refresh ? { refresh: true } : {}),
    }
  )
}

/**
 * Update workflow context with new data.
 *
 * SECURITY: builds on the UNSCOPED {@link getWorkflowInstance} and therefore
 * performs no tenant/organization filtering of its own. It is preserved as-is
 * for backward compatibility (it is a DI-exposed surface). HTTP handlers MUST
 * use {@link updateWorkflowContextScoped} instead.
 *
 * @param em - Entity manager
 * @param instanceId - Workflow instance ID
 * @param updates - Context updates (merged with existing context)
 */
export async function updateWorkflowContext(
  em: EntityManager,
  instanceId: string,
  updates: Record<string, any>
): Promise<void> {
  const instance = await getWorkflowInstance(em, instanceId)
  if (!instance) {
    throw new WorkflowExecutionError(
      `Workflow instance not found: ${instanceId}`,
      'INSTANCE_NOT_FOUND',
      { instanceId }
    )
  }

  instance.context = {
    ...instance.context,
    ...updates,
  }
  instance.updatedAt = new Date()

  await em.flush()
}

/**
 * Context keys the engine owns. A caller-supplied patch may never write them:
 * `__result` carries the terminal workflow result, `_pendingAsyncActivities`
 * tracks in-flight async activity jobs, and `__park` marks a parked agent step.
 * Overwriting any of them would corrupt a running instance, so they are
 * rejected rather than silently dropped.
 */
export const RESERVED_WORKFLOW_CONTEXT_KEYS: readonly string[] = [
  '__result',
  '_pendingAsyncActivities',
  '__park',
  WORKFLOW_ERROR_CONTEXT_KEY,
]

export function findReservedContextKeys(updates: Record<string, unknown>): string[] {
  return Object.keys(updates).filter((key) => RESERVED_WORKFLOW_CONTEXT_KEYS.includes(key))
}

export interface UpdateWorkflowContextScopedOptions {
  instanceId: string
  tenantId: string
  organizationId: string
  updates: Record<string, unknown>
  /**
   * Optional version check, awaited with the freshly loaded row's `updatedAt`
   * before the patch is applied. HTTP callers pass
   * `enforceCommandOptimisticLockWithGuards` here so a stale write 409s instead
   * of silently clobbering a concurrent context change.
   */
  assertVersion?: (current: Date | null | undefined) => void | Promise<void>
}

/**
 * Tenant/organization-scoped sibling of {@link updateWorkflowContext}: the
 * scope is part of the lookup, so a cross-tenant instance id resolves to
 * nothing and the caller returns a 404 rather than reading or writing another
 * tenant's run. Shallow merge, consistent with the legacy helper.
 */
export async function updateWorkflowContextScoped(
  em: EntityManager,
  options: UpdateWorkflowContextScopedOptions
): Promise<WorkflowInstance> {
  const { instanceId, tenantId, organizationId, updates, assertVersion } = options

  const reserved = findReservedContextKeys(updates)
  if (reserved.length > 0) {
    throw new WorkflowExecutionError(
      `Reserved workflow context keys cannot be written: ${reserved.join(', ')}`,
      'RESERVED_CONTEXT_KEY',
      { instanceId, reserved }
    )
  }

  const instance = await findOneWithDecryption(
    em as PostgreSqlEntityManager,
    WorkflowInstance,
    { id: instanceId, tenantId, organizationId },
    undefined,
    { tenantId, organizationId }
  )
  if (!instance) {
    throw new WorkflowExecutionError(
      `Workflow instance not found: ${instanceId}`,
      'INSTANCE_NOT_FOUND',
      { instanceId }
    )
  }

  if (instance.status !== 'RUNNING' && instance.status !== 'PAUSED' && instance.status !== 'FORKED') {
    throw new WorkflowExecutionError(
      `Workflow instance is not accepting context updates: ${instance.status}`,
      'INSTANCE_NOT_UPDATABLE',
      { instanceId, status: instance.status }
    )
  }

  if (assertVersion) await assertVersion(instance.updatedAt)

  instance.context = {
    ...instance.context,
    ...updates,
  }
  instance.updatedAt = new Date()

  await em.flush()

  return instance
}

// findWorkflowDefinition is imported from ./find-definition

type InstanceLifecycleEventId =
  | 'workflows.instance.created'
  | 'workflows.instance.started'
  | 'workflows.instance.completed'
  | 'workflows.instance.failed'
  | 'workflows.instance.cancelled'

/**
 * Publish a declared `workflows.instance.*` lifecycle event to the event bus,
 * alongside (never instead of) the internal `WorkflowEvent` audit row. Delivery
 * is at-least-once and consumers must be idempotent; a bus failure must never
 * break workflow execution, so this is strictly best-effort.
 */
async function emitInstanceLifecycleEvent(
  instance: WorkflowInstance,
  eventId: InstanceLifecycleEventId,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    await emitWorkflowsEvent(
      eventId,
      {
        id: instance.id,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
        workflowId: instance.workflowId,
        version: instance.version,
        status: instance.status,
        stepId: instance.currentStepId ?? null,
        ...extra,
      },
      { persistent: true }
    )
  } catch (error) {
    console.error(
      `[WORKFLOW] Failed to emit ${eventId} for instance ${instance.id}:`,
      error instanceof Error ? error.message : error
    )
  }
}

/**
 * Log workflow event to event sourcing table
 *
 * @param em - Entity manager
 * @param event - Event data
 */
async function logWorkflowEvent(
  em: EntityManager,
  event: {
    workflowInstanceId: string
    stepInstanceId?: string
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
