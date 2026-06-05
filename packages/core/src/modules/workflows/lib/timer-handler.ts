/**
 * Timer Handler Service
 *
 * Fires timers for WAIT_FOR_TIMER steps: resumes a paused workflow instance
 * when its scheduled timer job is processed by the activity worker.
 */

import { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance, WorkflowDefinition, StepInstance } from '../data/entities'
import type * as eventLoggerModule from './event-logger'
import type * as stepHandlerModule from './step-handler'
import type * as transitionHandlerModule from './transition-handler'
import type * as workflowExecutorModule from './workflow-executor'

export interface FireTimerOptions {
  instanceId: string
  stepInstanceId?: string
  branchInstanceId?: string | null
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
  const { instanceId, stepInstanceId, branchInstanceId, userId, tenantId, organizationId } = options

  const eventLogger = container.resolve<typeof eventLoggerModule>('eventLogger')
  const stepHandler = container.resolve<typeof stepHandlerModule>('stepHandler')
  const transitionHandler = container.resolve<typeof transitionHandlerModule>('transitionHandler')
  const workflowExecutor = container.resolve<typeof workflowExecutorModule>('workflowExecutor')

  // Branch-scoped timer: the instance is FORKED and the branch is PAUSED at the
  // WAIT_FOR_TIMER step. Resume just that branch, then drive the parallel loop.
  if (branchInstanceId) {
    await eventLogger.logWorkflowEvent(em, {
      workflowInstanceId: instanceId,
      stepInstanceId,
      branchInstanceId,
      eventType: 'TIMER_FIRED',
      eventData: { firedAt: new Date().toISOString(), branch: true },
      userId,
      tenantId,
      organizationId,
    })
    const { resumeBranch } = await import('./parallel-handler')
    const resumed = await resumeBranch(em, {
      instanceId,
      branchInstanceId,
      tenantId,
      organizationId,
      exitStepInstanceId: stepInstanceId,
      exitOutput: { firedAt: new Date().toISOString() },
    })
    if (resumed) {
      await workflowExecutor.executeWorkflow(em, container, instanceId, { userId })
    }
    return
  }

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

  await eventLogger.logWorkflowEvent(em, {
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

  const stepInstance = stepInstanceId
    ? await findOneWithDecryption(
        em as PostgreSqlEntityManager,
        StepInstance,
        {
          id: stepInstanceId,
          workflowInstanceId: instance.id,
          tenantId: instance.tenantId,
          organizationId: instance.organizationId,
        },
        undefined,
        { tenantId: instance.tenantId, organizationId: instance.organizationId },
      )
    : await findOneWithDecryption(
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

  await workflowExecutor.executeWorkflow(em, container, instance.id, { userId })
}
