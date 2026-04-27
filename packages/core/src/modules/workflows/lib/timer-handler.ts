/**
 * Timer Handler Service
 *
 * Fires timers for WAIT_FOR_TIMER steps: resumes a paused workflow instance
 * when its scheduled timer job is processed by the activity worker.
 */

import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { WorkflowInstance, WorkflowDefinition, StepInstance } from '../data/entities'
import { logWorkflowEvent } from './event-logger'
import { executeWorkflow } from './workflow-executor'
import * as stepHandler from './step-handler'
import * as transitionHandler from './transition-handler'

export interface FireTimerOptions {
  instanceId: string
  stepInstanceId?: string
  userId?: string
  tenantId: string
  organizationId: string
}

export class TimerError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message)
    this.name = 'TimerError'
  }
}

/**
 * Fire a timer and resume workflow execution.
 *
 * Mirrors `sendSignal` from signal-handler.ts — verifies the instance is
 * paused at a WAIT_FOR_TIMER step, logs TIMER_FIRED, exits the step, then
 * executes auto transitions and resumes the workflow.
 */
export async function fireTimer(
  em: EntityManager,
  container: AwilixContainer,
  options: FireTimerOptions
): Promise<void> {
  const { instanceId, stepInstanceId, userId, tenantId, organizationId } = options

  const instance = await em.findOne(WorkflowInstance, {
    id: instanceId,
    tenantId,
    organizationId,
  })

  if (!instance) {
    throw new TimerError(
      'Workflow instance not found',
      'INSTANCE_NOT_FOUND',
      { instanceId }
    )
  }

  if (instance.status !== 'PAUSED') {
    throw new TimerError(
      'Workflow is not paused',
      'WORKFLOW_NOT_PAUSED',
      { instanceId, status: instance.status }
    )
  }

  const definition = await em.findOne(WorkflowDefinition, instance.definitionId)
  if (!definition) {
    throw new TimerError(
      'Workflow definition not found',
      'DEFINITION_NOT_FOUND',
      { definitionId: instance.definitionId }
    )
  }

  const currentStep = definition.definition.steps.find(
    (s: any) => s.stepId === instance.currentStepId
  )

  if (!currentStep || currentStep.stepType !== 'WAIT_FOR_TIMER') {
    throw new TimerError(
      'Workflow is not waiting for timer',
      'NOT_WAITING_FOR_TIMER',
      { instanceId, currentStepId: instance.currentStepId }
    )
  }

  const now = new Date()
  instance.updatedAt = now

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    stepInstanceId,
    eventType: 'TIMER_FIRED',
    eventData: {
      stepId: instance.currentStepId,
      firedAt: now.toISOString(),
    },
    userId,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  // Find active step instance and exit it
  const stepInstance = stepInstanceId
    ? await em.findOne(StepInstance, {
        id: stepInstanceId,
        workflowInstanceId: instance.id,
      })
    : await em.findOne(StepInstance, {
        workflowInstanceId: instance.id,
        stepId: instance.currentStepId,
        status: 'ACTIVE',
      })

  if (stepInstance) {
    await stepHandler.exitStep(em, stepInstance, {
      firedAt: now.toISOString(),
    })
  }

  const autoTransitions = (definition.definition.transitions || []).filter(
    (t: any) => t.fromStepId === instance.currentStepId && t.trigger === 'auto'
  )

  if (autoTransitions.length === 0) {
    instance.status = 'RUNNING'
    await em.flush()
    return
  }

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
    instance.status = 'RUNNING'
    await em.flush()
    return
  }

  const transitionResult = await transitionHandler.executeTransition(
    em,
    container,
    instance,
    instance.currentStepId,
    firstValidTransition.transition.toStepId,
    transitionContext
  )

  if (!transitionResult.success) {
    throw new TimerError(
      'Transition failed after timer fired',
      'TRANSITION_FAILED',
      { error: transitionResult.error }
    )
  }

  await executeWorkflow(em, container, instance.id, { userId })
}
