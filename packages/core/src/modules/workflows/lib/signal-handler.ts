/**
 * Signal Handler Service
 *
 * Receives external signals and resumes workflows waiting for them.
 */

import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { WorkflowInstance, WorkflowDefinition, StepInstance } from '../data/entities'
import { logWorkflowEvent } from './event-logger'
import { executeWorkflow } from './workflow-executor'
import * as stepHandler from './step-handler'
import * as transitionHandler from './transition-handler'

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

  // Fetch workflow instance
  const instance = await em.findOne(WorkflowInstance, {
    id: instanceId,
    tenantId,
    organizationId,
  })

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

  // Load workflow definition to check current step
  const definition = await em.findOne(WorkflowDefinition, instance.definitionId)
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
  await logWorkflowEvent(em, {
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
  const stepInstance = await em.findOne(StepInstance, {
    workflowInstanceId: instance.id,
    stepId: instance.currentStepId,
    status: 'ACTIVE',
  })

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
  await executeWorkflow(em, container, instance.id, { userId })
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
  const instances = await em.find(WorkflowInstance, {
    correlationKey,
    status: 'PAUSED',
    tenantId,
    organizationId,
  })

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
