/**
 * Signal Handler Service
 *
 * Receives external signals and resumes workflows waiting for them.
 */

import { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance, WorkflowDefinition, StepInstance } from '../data/entities'
import type * as eventLoggerModule from './event-logger'
import type * as stepHandlerModule from './step-handler'
import type * as transitionHandlerModule from './transition-handler'
import type * as workflowExecutorModule from './workflow-executor'

export interface SendSignalOptions {
  /**
   * Workflow instance ID
   */
  instanceId: string

  /**
   * Signal name to match against WAIT_FOR_SIGNAL step config
   */
  signalName: string

  /**
   * Optional payload to merge into workflow context
   */
  payload?: Record<string, any>

  /**
   * User ID sending the signal
   */
  userId?: string

  /**
   * Tenant/org scope
   */
  tenantId: string
  organizationId: string
}

export class SignalError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message)
    this.name = 'SignalError'
  }
}

/**
 * Send signal to workflow instance and resume execution
 */
export async function sendSignal(
  em: EntityManager,
  container: AwilixContainer,
  options: SendSignalOptions
): Promise<void> {
  const { instanceId, signalName, payload, userId, tenantId, organizationId } = options

  const eventLogger = container.resolve<typeof eventLoggerModule>('eventLogger')
  const stepHandler = container.resolve<typeof stepHandlerModule>('stepHandler')
  const transitionHandler = container.resolve<typeof transitionHandlerModule>('transitionHandler')
  const workflowExecutor = container.resolve<typeof workflowExecutorModule>('workflowExecutor')

  // Fetch workflow instance
  const instance = await findOneWithDecryption(
    em as PostgreSqlEntityManager,
    WorkflowInstance,
    {
      id: instanceId,
      tenantId,
      organizationId,
    },
    undefined,
    { tenantId, organizationId },
  )

  if (!instance) {
    throw new SignalError(
      'Workflow instance not found',
      'INSTANCE_NOT_FOUND',
      { instanceId }
    )
  }

  // Verify workflow is paused
  if (instance.status !== 'PAUSED') {
    throw new SignalError(
      'Workflow is not paused',
      'WORKFLOW_NOT_PAUSED',
      { instanceId, status: instance.status }
    )
  }

  // Load workflow definition with tenant/org scope to check current step
  const definition = await findOneWithDecryption(
    em as PostgreSqlEntityManager,
    WorkflowDefinition,
    {
      id: instance.definitionId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: instance.tenantId, organizationId: instance.organizationId },
  )
  if (!definition) {
    throw new SignalError(
      'Workflow definition not found',
      'DEFINITION_NOT_FOUND',
      { definitionId: instance.definitionId }
    )
  }

  // Find current step
  const currentStep = definition.definition.steps.find(
    (s: any) => s.stepId === instance.currentStepId
  )

  if (!currentStep || currentStep.stepType !== 'WAIT_FOR_SIGNAL') {
    throw new SignalError(
      'Workflow is not waiting for signal',
      'NOT_WAITING_FOR_SIGNAL',
      { instanceId, currentStepId: instance.currentStepId }
    )
  }

  // Check signal name matches
  const expectedSignalName = currentStep.signalConfig?.signalName || currentStep.stepId
  if (expectedSignalName !== signalName) {
    throw new SignalError(
      'Signal name mismatch',
      'SIGNAL_NAME_MISMATCH',
      { expected: expectedSignalName, received: signalName }
    )
  }

  const now = new Date()

  // Merge signal payload into workflow context
  if (payload) {
    instance.context = {
      ...instance.context,
      ...payload,
      [`signal_${signalName}_payload`]: payload,
      [`signal_${signalName}_receivedAt`]: now.toISOString(),
    }
  }

  instance.updatedAt = now

  // Log signal received event
  await eventLogger.logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: 'SIGNAL_RECEIVED',
    eventData: {
      signalName,
      payload,
    },
    userId,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  // Find active step instance and exit it
  const stepInstance = await findOneWithDecryption(
    em as PostgreSqlEntityManager,
    StepInstance,
    {
      workflowInstanceId: instance.id,
      stepId: instance.currentStepId,
      status: 'ACTIVE',
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    },
    undefined,
    { tenantId: instance.tenantId, organizationId: instance.organizationId },
  )

  if (stepInstance) {
    await stepHandler.exitStep(em, stepInstance, {
      signalName,
      payload,
    })
  }

  // Find automatic transitions from current step
  const autoTransitions = (definition.definition.transitions || []).filter(
    (t: any) => t.fromStepId === instance.currentStepId && t.trigger === 'auto'
  )

  if (autoTransitions.length === 0) {
    // No automatic transitions, mark as RUNNING but stay at current step
    instance.status = 'RUNNING'
    await em.flush()
    return
  }

  // Find valid transitions
  const transitionContext = {
    workflowContext: instance.context,
    userId,
  }

  const validTransitions = await transitionHandler.findValidTransitions(
    em,
    instance,
    instance.currentStepId,
    transitionContext
  )

  const firstValidTransition = validTransitions.find((t) => t.isValid)

  if (!firstValidTransition || !firstValidTransition.transition) {
    // No valid transitions, mark as RUNNING anyway
    instance.status = 'RUNNING'
    await em.flush()
    return
  }

  // Execute transition to next step
  const transitionResult = await transitionHandler.executeTransition(
    em,
    container,
    instance,
    instance.currentStepId,
    firstValidTransition.transition.toStepId,
    transitionContext
  )

  if (!transitionResult.success) {
    throw new SignalError(
      'Transition failed after signal',
      'TRANSITION_FAILED',
      { error: transitionResult.error }
    )
  }

  // Resume workflow execution
  await workflowExecutor.executeWorkflow(em, container, instance.id, { userId })
}

/**
 * Send signal by correlation key (finds all waiting instances)
 */
export async function sendSignalByCorrelationKey(
  em: EntityManager,
  container: AwilixContainer,
  options: Omit<SendSignalOptions, 'instanceId'> & { correlationKey: string }
): Promise<number> {
  const { correlationKey, signalName, payload, userId, tenantId, organizationId } = options

  // Find all paused instances with this correlation key
  const instances = await findWithDecryption(
    em as PostgreSqlEntityManager,
    WorkflowInstance,
    {
      correlationKey,
      status: 'PAUSED',
      tenantId,
      organizationId,
    },
    undefined,
    { tenantId, organizationId },
  )

  let signalsProcessed = 0

  for (const instance of instances) {
    try {
      await sendSignal(em, container, {
        instanceId: instance.id,
        signalName,
        payload,
        userId,
        tenantId,
        organizationId,
      })
      signalsProcessed++
    } catch (error) {
      // Log error but continue processing other instances
      console.error(`Failed to send signal to instance ${instance.id}:`, error)
    }
  }

  return signalsProcessed
}
