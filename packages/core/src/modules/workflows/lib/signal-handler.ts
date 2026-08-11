/**
 * Signal Handler Service
 *
 * Receives external signals and resumes workflows waiting for them.
 */

import { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance, WorkflowBranchInstance, WorkflowDefinition, StepInstance } from '../data/entities'
import { INVOKE_AGENT_SIGNAL_NAME, SUB_WORKFLOW_SIGNAL_NAME } from './activity-executor'
import type * as eventLoggerModule from './event-logger'
import type * as stepHandlerModule from './step-handler'
import type * as transitionHandlerModule from './transition-handler'
import type * as workflowExecutorModule from './workflow-executor'
import { resolveCodeDefinitionForInstance } from './find-definition'
import {
  WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY,
  buildAgentOutcomeContextEntry,
  mapDispositionToAgentOutcome,
  type AgentOutcomeKind,
} from './outcome-routing'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

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

  /** Engine-owned outcome metadata kept separate from author-visible mappings. */
  agentOutcome?: AgentOutcomeKind

  /** Proposal identifier associated with `agentOutcome`, when present. */
  agentProposalId?: string

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
  const {
    instanceId,
    signalName,
    payload,
    agentOutcome,
    agentProposalId,
    userId,
    tenantId,
    organizationId,
  } = options

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

  // Branch-scoped signal: a FORKED instance routes the signal to the branch
  // paused at a matching WAIT_FOR_SIGNAL step.
  if (instance.status === 'FORKED') {
    const branchDefinition = (await findOneWithDecryption(
      em as PostgreSqlEntityManager,
      WorkflowDefinition,
      { id: instance.definitionId, tenantId: instance.tenantId, organizationId: instance.organizationId, deletedAt: null },
      undefined,
      { tenantId: instance.tenantId, organizationId: instance.organizationId },
    )) ?? resolveCodeDefinitionForInstance(instance)
    if (!branchDefinition) {
      throw new SignalError('Workflow definition not found', 'DEFINITION_NOT_FOUND', { definitionId: instance.definitionId })
    }

    const pausedBranches = await em.find(WorkflowBranchInstance, {
      workflowInstanceId: instanceId,
      status: 'PAUSED',
      tenantId,
      organizationId,
    })

    let targetBranch: WorkflowBranchInstance | null = null
    for (const candidate of pausedBranches) {
      const step = branchDefinition.definition.steps.find((s: any) => s.stepId === candidate.currentStepId)
      if (step?.stepType === 'WAIT_FOR_SIGNAL') {
        const candidateSignal = step.signalConfig?.signalName || step.stepId
        if (candidateSignal === signalName) {
          targetBranch = candidate
          break
        }
      }
    }

    if (!targetBranch) {
      throw new SignalError('No parallel branch awaiting this signal', 'NO_BRANCH_AWAITING_SIGNAL', { instanceId, signalName })
    }

    const branchStepInstance = await em.findOne(StepInstance, {
      workflowInstanceId: instanceId,
      branchInstanceId: targetBranch.id,
      stepId: targetBranch.currentStepId,
      status: 'ACTIVE',
    })

    await eventLogger.logWorkflowEvent(em, {
      workflowInstanceId: instanceId,
      stepInstanceId: branchStepInstance?.id,
      branchInstanceId: targetBranch.id,
      eventType: 'SIGNAL_RECEIVED',
      eventData: { signalName, branch: true },
      userId,
      tenantId,
      organizationId,
    })

    const { resumeBranch } = await import('./parallel-handler')
    const resumed = await resumeBranch(em, {
      instanceId,
      branchInstanceId: targetBranch.id,
      tenantId,
      organizationId,
      contextMerge: payload,
      exitStepInstanceId: branchStepInstance?.id ?? null,
      exitOutput: { signalName, payload },
    })
    if (resumed) {
      await workflowExecutor.executeWorkflow(em, container, instanceId, { userId })
    }
    return
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
  const definition = (await findOneWithDecryption(
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
  )) ?? resolveCodeDefinitionForInstance(instance)
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

  // A dedicated WAIT_FOR_SIGNAL step — OR any step that parked while declaring a
  // `signalConfig.signalName` (e.g. an AUTOMATED step whose INVOKE_AGENT activity
  // routed its proposal to a human) — can be resumed by a matching signal. The
  // resume path below (merge payload → exit step → run auto transitions) is
  // step-type-agnostic, so widening this guard is additive and safe.
  //
  // INVOKE_AGENT steps run their agent asynchronously (off the workflow
  // transaction) and park on `agent_orchestrator.proposal.ready`; recognize them
  // even when the definition omits an explicit `signalConfig.signalName` (e.g.
  // seeded blueprints not re-saved through the visual editor) so the activity
  // worker can resume them after the agent completes.
  const isInvokeAgentStep =
    !!currentStep &&
    Array.isArray(currentStep.activities) &&
    currentStep.activities.some((a: any) => a?.activityType === 'INVOKE_AGENT')
  // SUB_WORKFLOW steps park while their child instance runs its own async/agent
  // steps and resume on SUB_WORKFLOW_SIGNAL_NAME once the child terminates;
  // recognize them even without an explicit signalConfig.signalName.
  const isSubWorkflowStep = !!currentStep && currentStep.stepType === 'SUB_WORKFLOW'
  const stepCanReceiveSignal =
    !!currentStep &&
    (currentStep.stepType === 'WAIT_FOR_SIGNAL' ||
      !!currentStep.signalConfig?.signalName ||
      isInvokeAgentStep ||
      isSubWorkflowStep)
  if (!stepCanReceiveSignal) {
    throw new SignalError(
      'Workflow is not waiting for signal',
      'NOT_WAITING_FOR_SIGNAL',
      { instanceId, currentStepId: instance.currentStepId }
    )
  }

  // Check signal name matches
  const expectedSignalName =
    currentStep.signalConfig?.signalName ||
    (isInvokeAgentStep
      ? INVOKE_AGENT_SIGNAL_NAME
      : isSubWorkflowStep
        ? SUB_WORKFLOW_SIGNAL_NAME
        : currentStep.stepId)
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

  // Outcome routing (spec 7.2). The signal is how EVERY resolved disposition
  // reaches a parked agent step — the activity worker's auto_approved and
  // researcher resumes and the human dispose path alike — so this is the one
  // place the disposition has to be translated into the engine-owned outcome
  // marker the executor routes on. Recorded regardless of who sent the signal;
  // the author-visible `disposition` key stays untouched and unread by routing.
  if (isInvokeAgentStep && instance.currentStepId) {
    const resolvedOutcome = agentOutcome ?? mapDispositionToAgentOutcome(
      (payload as Record<string, unknown> | undefined)?.disposition,
    )
    if (resolvedOutcome) {
      const proposalId = agentProposalId
        ?? (payload as Record<string, unknown> | undefined)?.agentProposalId
        ?? (payload as Record<string, unknown> | undefined)?.proposalId
      instance.context = {
        ...instance.context,
        [WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]: buildAgentOutcomeContextEntry(
          instance.currentStepId,
          resolvedOutcome,
          typeof proposalId === 'string' ? proposalId : undefined,
        ),
      }
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

  // Outcome routing (spec 7.2). A resumed agent step is advanced HERE, not by
  // the executor loop, so the wired outcome route has to be honoured here too —
  // routing it in only one of the two places would silently send every
  // human-dispositioned proposal down the happy path.
  // Imported lazily rather than read off the DI-resolved executor: the resolved
  // service is the module, and reaching for a named export on it couples this
  // path to every test double that stubs only the two methods it needed.
  const { dispatchAgentOutcomeForCurrentStep } = await import('./workflow-executor')
  const outcomeDispatch = await dispatchAgentOutcomeForCurrentStep(
    em,
    container,
    instance,
    definition.definition,
    { workflowContext: instance.context, userId },
  )
  if (outcomeDispatch && outcomeDispatch.kind !== 'default') {
    if (outcomeDispatch.kind === 'failed') {
      await workflowExecutor.completeWorkflow(em, container, instance.id, 'FAILED', {
        error: outcomeDispatch.error,
      })
      return
    }
    if (outcomeDispatch.kind === 'parked') return
    if (outcomeDispatch.paused || instance.status === 'PAUSED') return
    instance.status = 'RUNNING'
    await em.flush()
    await workflowExecutor.executeWorkflow(em, container, instance.id, { userId })
    return
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

  // Resume from the paused wait: flip to RUNNING before executing the transition
  // and re-entering executeWorkflow. Without this the executor's defense-in-depth
  // PAUSED check stops the run after the first traversed step, so an intermediate
  // AUTOMATED step (e.g. an emit-event "flag") between the waiting step and END
  // leaves the instance permanently parked — and any parent sub-workflow waiting on
  // its completion never resumes. The no-transition branches above already do this.
  instance.status = 'RUNNING'
  await em.flush()

  // Execute transition to next step
  const transitionResult = await transitionHandler.executeTransition(
    em,
    container,
    instance,
    instance.currentStepId,
    firstValidTransition.transition.toStepId,
    { ...transitionContext, transitionId: firstValidTransition.transition.transitionId },
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
      logger.error('Failed to send signal to instance', { instanceId: instance.id, err: error })
    }
  }

  return signalsProcessed
}
