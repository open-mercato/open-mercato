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
   * Step the caller observed the instance waiting on. When set, the signal is
   * refused with `WORKFLOW_NOT_PAUSED` unless the instance is still parked on
   * exactly this step, so a delivery addressed to one wait can never consume a
   * later wait the instance has since parked on.
   */
  expectedStepId?: string

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
    expectedStepId,
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

  if (expectedStepId !== undefined && instance.currentStepId !== expectedStepId) {
    throw new SignalError(
      'Workflow is not paused',
      'WORKFLOW_NOT_PAUSED',
      { instanceId, reason: 'step_changed', expectedStepId, currentStepId: instance.currentStepId }
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

  // Claim the wait before mutating anything (#7185). Every check above reads a
  // snapshot, so concurrent deliveries of the same signal all pass it; only the
  // conditional UPDATE is atomic, and exactly one delivery wins it. Pinning the
  // validated `currentStepId` stops a stale delivery from consuming a LATER wait
  // the winner has since parked on. Losers surface as WORKFLOW_NOT_PAUSED, which
  // the instance signal route already maps to 409.
  const claimed = await em.nativeUpdate(
    WorkflowInstance,
    {
      id: instance.id,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
      status: 'PAUSED',
      currentStepId: instance.currentStepId,
    },
    { status: 'RUNNING', updatedAt: now },
  )
  if (claimed === 0) {
    throw new SignalError(
      'Workflow is not paused',
      'WORKFLOW_NOT_PAUSED',
      { instanceId, reason: 'claimed_by_concurrent_delivery' }
    )
  }
  const claimedStepId = instance.currentStepId
  const preClaimContext = instance.context
  const preClaimUpdatedAt = instance.updatedAt
  // Mirror the claimed row onto the identity-mapped entity so later flushes
  // cannot write the pre-claim status back.
  instance.status = 'RUNNING'

  try {
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

    // Log signal received event. Its flush is the first write of this delivery
    // to commit (the payload, the outcome marker and the event land together).
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
  } catch (error) {
    // The claim committed on its own but nothing else of this delivery did, so
    // hand the wait back: otherwise every retry would be refused as a duplicate
    // of a delivery that never landed and the signal would be lost.
    await releaseSignalClaim(em, instance, claimedStepId, preClaimContext, preClaimUpdatedAt)
    throw error
  }

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
  //
  // Resume from the paused wait BEFORE dispatching, exactly as the ordinary
  // resume path below does. On this path the instance is PAUSED by definition —
  // it is parked on the very signal being delivered — and two things depended on
  // that being cleared first: the executor's defence-in-depth PAUSED guard stops
  // a routed run at its first step, and `instance.status === 'PAUSED'` below
  // could never mean "this dispatch parked the run" while the pre-existing pause
  // was still set. Every routed outcome therefore returned early and the run sat
  // on its route target, PAUSED, forever (TC-WF-051, TC-WF-052).
  instance.status = 'RUNNING'
  await em.flush()

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
    // `paused` is the dispatch's own report that IT parked the run (a
    // step-through release, a wait step on the far side of the route).
    if (outcomeDispatch.paused) return
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

async function releaseSignalClaim(
  em: EntityManager,
  instance: WorkflowInstance,
  claimedStepId: string,
  preClaimContext: WorkflowInstance['context'],
  preClaimUpdatedAt: WorkflowInstance['updatedAt'],
): Promise<void> {
  instance.status = 'PAUSED'
  instance.context = preClaimContext
  instance.updatedAt = preClaimUpdatedAt
  try {
    await em.nativeUpdate(
      WorkflowInstance,
      {
        id: instance.id,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
        status: 'RUNNING',
        currentStepId: claimedStepId,
      },
      { status: 'PAUSED', updatedAt: new Date() },
    )
  } catch (releaseError) {
    logger.error('Failed to release signal claim', { instanceId: instance.id, err: releaseError })
  }
}

export type SendSignalByCorrelationKeyOptions = Omit<SendSignalOptions, 'instanceId'> & { correlationKey: string }

export interface SignalDeliveryFailure {
  instanceId: string
  code: string
  message: string
}

export interface SendSignalByCorrelationKeyResult {
  count: number
  failures: SignalDeliveryFailure[]
}

/**
 * Send signal by correlation key (finds all waiting instances)
 *
 * Returns only the number of instances that were advanced; use
 * `sendSignalByCorrelationKeyWithResults` to learn which instances failed.
 */
export async function sendSignalByCorrelationKey(
  em: EntityManager,
  container: AwilixContainer,
  options: SendSignalByCorrelationKeyOptions
): Promise<number> {
  const { count } = await sendSignalByCorrelationKeyWithResults(em, container, options)
  return count
}

/**
 * Send signal by correlation key and report every per-instance failure, so a
 * caller can tell which instances were not advanced (including deliveries that
 * lost the claim to a concurrent one, reported as `WORKFLOW_NOT_PAUSED`).
 */
export async function sendSignalByCorrelationKeyWithResults(
  em: EntityManager,
  container: AwilixContainer,
  options: SendSignalByCorrelationKeyOptions
): Promise<SendSignalByCorrelationKeyResult> {
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

  // Snapshot the wait each instance was listed on before delivering anything:
  // re-reads below refresh the identity-mapped entities, and a delivery must
  // only consume the wait it was addressed to, never a later one a concurrent
  // fan-out has already advanced the instance onto.
  const targets = instances.map((instance) => ({ id: instance.id, currentStepId: instance.currentStepId }))

  let signalsProcessed = 0
  const failures: SignalDeliveryFailure[] = []

  for (const instance of targets) {
    try {
      await sendSignal(em, container, {
        instanceId: instance.id,
        expectedStepId: instance.currentStepId,
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
      // Only a SignalError's message is a deliberate, caller-safe description;
      // anything else may carry internals and is reported generically.
      failures.push(
        error instanceof SignalError
          ? { instanceId: instance.id, code: error.code, message: error.message }
          : { instanceId: instance.id, code: 'SIGNAL_DELIVERY_FAILED', message: 'Failed to deliver signal' },
      )
    }
  }

  return { count: signalsProcessed, failures }
}
