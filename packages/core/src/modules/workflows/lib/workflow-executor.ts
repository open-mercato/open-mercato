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
import type { AwilixContainer } from 'awilix'
import {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowEvent,
  type WorkflowInstanceStatus,
} from '../data/entities'
import { compensateWorkflow } from './compensation-handler'

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
  }
  tenantId: string
  organizationId: string
}

export interface ExecutionContext {
  userId?: string
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
    tenantId,
    organizationId,
    createdAt: now,
    updatedAt: now,
  })

  await em.persistAndFlush(instance)

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

      const definition = await trx.findOne(WorkflowDefinition, {
        id: instance.definitionId,
      })

      if (!definition) {
        throw new WorkflowExecutionError(
          `Workflow definition not found: ${instance.definitionId}`,
          'DEFINITION_NOT_FOUND',
          { definitionId: instance.definitionId }
        )
      }

      const maxIterations = 100
      let iterations = 0

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

        const currentStep = definition.definition.steps.find(
          (s: any) => s.stepId === currentInstance.currentStepId
        )

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
          currentStep?.stepType === 'TIMER'
        ) {
          return {
            status: 'RUNNING',
            currentStep: currentInstance.currentStepId,
            context: currentInstance.context,
            events,
            executionTime: Date.now() - startTime,
          }
        }

        const transitions = definition.definition.transitions.filter(
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
          userId: context?.userId,
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
            evalContext
          )

          if (!transitionResult.success) {
            errors.push(transitionResult.error || 'Transition failed')

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

          await trx.flush()
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          console.error('[WORKFLOW] Transition execution failed:', error)
          console.error('[WORKFLOW] Error stack:', error instanceof Error ? error.stack : 'No stack trace')
          errors.push(errorMessage)

          events.push({
            eventType: 'TRANSITION_FAILED',
            occurredAt: new Date(),
            data: {
              transitionId: selectedTransition.transitionId,
              error: errorMessage,
            },
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
      errors.push(errorMessage)

      try {
        const instance = await getWorkflowInstanceForExecution(trx, instanceId, { refresh: true })
        if (instance && instance.status === 'RUNNING') {
          instance.status = 'FAILED'
          instance.errorMessage = errorMessage
          instance.errorDetails = error instanceof WorkflowExecutionError ? error.details : undefined
          instance.updatedAt = new Date()
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
        console.error('Failed to update instance with error:', updateError)
      }

      throw error
    }
  }

  return typeof transactionalEm.transactional === 'function'
    ? transactionalEm.transactional((trx) => runExecution(trx))
    : runExecution(em)
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

  // Trigger compensation if workflow failed and has compensatable activities (Phase 8.2)
  if (status === 'FAILED') {
    const definition = await em.findOne(WorkflowDefinition, { id: instance.definitionId })

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

        console.log(
          `[Workflow] Compensation ${compensationResult.status}: ${compensationResult.compensatedActivities}/${compensationResult.totalActivities} activities`
        )

        // Note: instance status already updated by compensateWorkflow
        // It will be COMPENSATED or remain FAILED
        return
      } catch (error: any) {
        console.error(`[Workflow] Compensation failed with exception:`, error)
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
  instanceId: string
): Promise<void> {
  const transactionalEm = em as EntityManager & {
    transactional?: <TResult>(callback: (trx: EntityManager) => Promise<TResult>) => Promise<TResult>
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
      console.warn('[WORKFLOW] No pending transition found during resume')
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

    console.log('[WORKFLOW] Completing pending transition:', {
      toStepId: pendingTransition.toStepId,
      from: instance.currentStepId,
    })

    const definition = await trx.findOneOrFail(WorkflowDefinition, {
      id: instance.definitionId,
    })

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

    const { executeStep } = await import('./step-handler')
    await executeStep(
      trx,
      instance,
      pendingTransition.toStepId,
      {
        workflowContext: instance.context || {},
        userId: undefined,
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
 * Get workflow instance by ID
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
 * Update workflow context with new data
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
 * Find workflow definition by ID and optional version
 *
 * @param em - Entity manager
 * @param options - Search options
 * @returns Workflow definition or null
 */
async function findWorkflowDefinition(
  em: EntityManager,
  options: {
    workflowId: string
    version?: number
    tenantId: string
    organizationId: string
  }
): Promise<WorkflowDefinition | null> {
  const { workflowId, version, tenantId, organizationId } = options

  const where: any = {
    workflowId,
    tenantId,
    organizationId,
    deletedAt: null,
  }

  if (version !== undefined) {
    where.version = version
  }

  // If no version specified, get latest enabled version
  if (version === undefined) {
    where.enabled = true
    return em.findOne(WorkflowDefinition, where, {
      orderBy: { version: 'DESC' },
    })
  }

  return em.findOne(WorkflowDefinition, where)
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

  await em.persistAndFlush(workflowEvent)
  return workflowEvent
}
