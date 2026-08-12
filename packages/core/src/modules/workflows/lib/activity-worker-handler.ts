/**
 * Workflow Activity Worker Handler
 *
 * Background worker that processes async activities from the queue.
 * Executes activities with timeout, logs events, and triggers workflow resume.
 */

import { JobHandler } from '@open-mercato/queue'
import {
  WorkflowActivityJob,
  WorkflowActivityJobActivity,
  WorkflowActivityJobInvokeAgent,
  WorkflowActivityJobResumeSubWorkflowParent,
} from './activity-queue-types'
import { mapAgentResultToContext } from './agent-result-mapping'
import type { AgentDispositionReview } from './agent-disposition-task'
import {
  WORKFLOW_GUARDRAIL_BLOCK_CONTEXT_KEY,
  isGuardrailBlockedError,
  listWiredOutcomes,
  readGuardrailBlockEvidenceRef,
  type AgentOutcomeKind,
  type OutcomeRoutingDefinitionLike,
} from './outcome-routing'
import { WORKFLOW_ERROR_CONTEXT_KEY, buildErrorContextEntry } from './error-routing'
import { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { WorkflowDefinition, WorkflowInstance, StepInstance } from '../data/entities'
import type { WorkflowIoContract } from '../data/validators'
import { logWorkflowEvent } from './event-logger'
import './activity-registry-bootstrap'
import type { ActivityContext } from './activity-executor'
import { SUB_WORKFLOW_SIGNAL_NAME } from './activity-executor'
import { getActivityType, type ActivityExecuteDeps } from './activity-registry'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows').child({ component: 'activity-worker' })
const INVOKE_AGENT_QUEUE_MAX_ATTEMPTS = 3

/**
 * Shared async dispatch through the Activity Registry — the single lookup
 * path for every queue consumer (this handler and the auto-discovered
 * workers/workflow-activities.worker.ts). Importing this module also
 * guarantees the registry bootstrap and the executor handler binding are in
 * place, so callers never need their own side-effect imports.
 */
export async function executeRegistryActivity(
  payload: Pick<WorkflowActivityJobActivity, 'activityType' | 'activityConfig'>,
  activityContext: ActivityContext,
  deps: ActivityExecuteDeps
): Promise<unknown> {
  const entry = getActivityType(payload.activityType)
  if (!entry) {
    throw new Error(`Unsupported activity type: ${payload.activityType}`)
  }
  if (entry.async.capable === false) {
    throw new Error(
      `[internal] Activity type ${payload.activityType} cannot run asynchronously (${entry.async.reason})`
    )
  }
  const runActivity = entry.executeAsync ?? entry.execute
  return await runActivity(payload.activityConfig, activityContext, deps)
}

/**
 * Create activity worker handler for queue processing
 *
 * @param em - Entity manager
 * @param container - DI container
 * @returns JobHandler function
 */
export function createActivityWorkerHandler(
  em: EntityManager,
  container: AwilixContainer
): JobHandler<WorkflowActivityJob> {
  return async (job, ctx) => {
    const { payload } = job
    const startTime = Date.now()

    // Timer jobs (kind: 'timer') are a distinct flow — they resume a paused
    // workflow instance rather than executing an activity. Handle them first.
    if (payload.kind === 'timer') {
      logger.debug('Firing timer for instance', { instanceId: payload.workflowInstanceId, jobId: ctx.jobId })
      try {
        const { fireTimer } = await import('./timer-handler')
        await fireTimer(em, container, {
          instanceId: payload.workflowInstanceId,
          stepInstanceId: payload.stepInstanceId,
          tenantId: payload.tenantId,
          organizationId: payload.organizationId,
          userId: payload.userId,
        })
      } catch (error: any) {
        logger.error('Failed to fire timer for instance', { instanceId: payload.workflowInstanceId, err: error })
        throw error
      }
      return
    }

    // Condition jobs are the durability backstop for WAIT_FOR_CONDITION steps:
    // they re-evaluate the predicate and enforce the absolute deadline. A job
    // whose waiter was already resumed by the event-driven path is a no-op.
    if (payload.kind === 'condition') {
      logger.debug('Evaluating wait condition', {
        instanceId: payload.workflowInstanceId,
        stepInstanceId: payload.stepInstanceId,
        attempt: payload.attempt,
        jobId: ctx.jobId,
      })
      try {
        const { evaluateWaitCondition } = await import('./condition-handler')
        await evaluateWaitCondition(em, container, {
          instanceId: payload.workflowInstanceId,
          stepInstanceId: payload.stepInstanceId,
          branchInstanceId: payload.branchInstanceId,
          deadlineAt: payload.deadlineAt,
          attempt: payload.attempt,
          tenantId: payload.tenantId,
          organizationId: payload.organizationId,
          userId: payload.userId,
        })
      } catch (error: unknown) {
        logger.error('Failed to evaluate wait condition', {
          instanceId: payload.workflowInstanceId,
          err: error,
        })
        throw error
      }
      return
    }

    // Task SLA jobs fire a reminder or the deadline breach for a USER_TASK. The
    // deadline is absolute on the payload and the handler is idempotent, so an
    // at-least-once delivery still breaches exactly once.
    if (payload.kind === 'task_sla') {
      logger.debug('Running task SLA job', {
        instanceId: payload.workflowInstanceId,
        userTaskId: payload.userTaskId,
        phase: payload.phase,
        jobId: ctx.jobId,
      })
      try {
        const { runTaskSlaJob } = await import('./task-sla')
        await runTaskSlaJob(em, container, {
          userTaskId: payload.userTaskId,
          stepInstanceId: payload.stepInstanceId,
          workflowInstanceId: payload.workflowInstanceId,
          branchInstanceId: payload.branchInstanceId,
          phase: payload.phase,
          deadlineAt: payload.deadlineAt,
          tenantId: payload.tenantId,
          organizationId: payload.organizationId,
          userId: payload.userId,
        })
      } catch (error: unknown) {
        logger.error('Failed to run task SLA job', {
          instanceId: payload.workflowInstanceId,
          userTaskId: payload.userTaskId,
          err: error,
        })
        throw error
      }
      return
    }

    // Invoke-agent jobs run an INVOKE_AGENT step's agent OUTSIDE the workflow
    // transaction, then resume the parked step (see handleInvokeAgentJob).
    if (payload.kind === 'invoke_agent') {
      await handleInvokeAgentJob(em, container, payload, {
        attemptNumber: ctx.attemptNumber,
        maxAttempts: INVOKE_AGENT_QUEUE_MAX_ATTEMPTS,
      })
      return
    }

    // Resume-parent jobs resume a parent instance parked on a SUB_WORKFLOW step
    // after its child reached a terminal state (see resumeParentAfterSubWorkflow).
    if (payload.kind === 'resume_subworkflow_parent') {
      await resumeParentAfterSubWorkflow(em, container, payload)
      return
    }

    // Workflow-level error handler jobs start the designated handler workflow
    // for a failed instance, outside the transaction that recorded the failure.
    if (payload.kind === 'workflow_error_handler') {
      logger.debug('Starting workflow error handler', {
        instanceId: payload.workflowInstanceId,
        handlerWorkflowId: payload.handlerWorkflowId,
        jobId: ctx.jobId,
      })
      const { runWorkflowErrorHandler } = await import('./error-handler')
      await runWorkflowErrorHandler(em, container, payload)
      return
    }

    logger.debug('Processing activity', { activityId: payload.activityId, jobId: ctx.jobId })

    try {
      // Fetch workflow instance
      const instance = await em.findOne(WorkflowInstance, {
        id: payload.workflowInstanceId,
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
      })

      if (!instance) {
        throw new Error(`Workflow instance ${payload.workflowInstanceId} not found`)
      }

      // Build activity context
      const activityContext = {
        workflowInstance: instance,
        workflowContext: payload.workflowContext,
        stepContext: payload.stepContext,
        stepInstanceId: payload.stepInstanceId,
        userId: payload.userId,
      }

      // Execute activity by type (with timeout if specified)
      let result: any

      const executeActivityByType = async () =>
        executeRegistryActivity(payload, activityContext, {
          em: em as PostgreSqlEntityManager,
          container,
        })

      // Apply timeout if specified
      if (payload.timeoutMs) {
        result = await Promise.race([
          executeActivityByType(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Activity timeout after ${payload.timeoutMs}ms`)),
              payload.timeoutMs
            )
          ),
        ])
      } else {
        result = await executeActivityByType()
      }

      const executionTimeMs = Date.now() - startTime

      // Log success event
      await logWorkflowEvent(em, {
        workflowInstanceId: payload.workflowInstanceId,
        stepInstanceId: payload.stepInstanceId,
        eventType: 'ACTIVITY_COMPLETED',
        eventData: {
          activityId: payload.activityId,
          activityName: payload.activityName,
          async: true,
          jobId: ctx.jobId,
          attemptNumber: ctx.attemptNumber,
          executionTimeMs,
          output: result,
        },
        userId: payload.userId,
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
      })

      logger.debug('Activity completed', { activityId: payload.activityId, executionTimeMs })

      // Trigger workflow resume check (via event or direct call)
      await checkAndResumeWorkflow(em, container, payload.workflowInstanceId)
    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime

      logger.error('Activity failed', { activityId: payload.activityId, err: error })

      // Log failure event
      await logWorkflowEvent(em, {
        workflowInstanceId: payload.workflowInstanceId,
        stepInstanceId: payload.stepInstanceId,
        eventType: 'ACTIVITY_FAILED',
        eventData: {
          activityId: payload.activityId,
          activityName: payload.activityName,
          async: true,
          jobId: ctx.jobId,
          attemptNumber: ctx.attemptNumber,
          error: error.message,
          executionTimeMs,
        },
        userId: payload.userId,
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
      })

      // Check if this was final attempt (BullMQ handles retries automatically)
      if (ctx.attemptNumber >= (payload.retryPolicy?.maxAttempts || 1)) {
        // Final failure - fail workflow
        await checkAndResumeWorkflow(em, container, payload.workflowInstanceId)
      }

      // Re-throw to let BullMQ handle retry
      throw error
    }
  }
}

/**
 * Structural retryable-error marker. The agent runtime raises transient
 * capacity rejections (e.g. `AgentCapacityError`) carrying `retryable: true`;
 * core cannot import enterprise error classes, so the contract is duck-typed on
 * that marker (mirrors how the bridge itself is resolved by DI key).
 */
export function isRetryableError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { retryable?: unknown }).retryable === true
}

/**
 * Minimal surface of the optional agent_orchestrator bridge consumed here.
 * Resolved by DI key so @open-mercato/core does not import the enterprise module.
 */
type AgentWorkflowBridgeLike = {
  invokeAgentForWorkflow: (args: {
    agentId: string
    input: unknown
    onResult: { autoApproveThreshold: number; autoApproveMargin?: number } | { alwaysAsk: true }
    ctx: {
      tenantId: string
      organizationId: string
      userId?: string
      processId: string
      stepId: string
      // Optional interpolated business-record descriptor (invokeAgentConfigSchema.subject).
      subject?: unknown
      // Optional already-resolved Review section (spec 7.5); see the identical
      // declaration in `lib/activity-executor.ts`.
      review?: AgentDispositionReview
      // The step's declared `invokeAgentConfigSchema.outputMapping`, forwarded so
      // a runtime that answers OUT OF BAND can honour it. On every settled path
      // this file applies `mapAgentResultToContext` itself after the bridge
      // returns, so the bridge never needs it — but a `suspended` outcome returns
      // BEFORE there is anything to map, and the resume then happens in another
      // process from a correlation row that would otherwise carry no mapping.
      // Additive and optional: a step declaring none passes no key at all, so a
      // bridge that ignores it is byte-identical to today.
      outputMapping?: Record<string, string>
    }
  }) => Promise<
    | { kind: 'researcher'; data: unknown }
    | { kind: 'auto_approved'; proposalId: string; payload: unknown }
    | { kind: 'user_task'; proposalId: string }
    // The agent proposed nothing: terminal like `researcher`, never parked.
    | { kind: 'none_proposed'; proposalId: string; payload: unknown }
    // The agent STARTED but answers out of band — an external runtime whose
    // provider calls back minutes later; see the identical declaration in
    // `lib/activity-executor.ts`. No result exists yet, so nothing is mapped
    // into workflow context and the step stays parked.
    | { kind: 'suspended'; runId: string; externalRunId?: string }
  >
}

/**
 * Run an INVOKE_AGENT step's agent OUTSIDE the workflow transaction, then resume
 * the parked step.
 *
 * The step parked on `agent_orchestrator.proposal.ready` (committing the workflow
 * transaction) before this job runs, so the agent — and all of its own
 * bookkeeping writes — execute on this worker's independent connection. That is
 * what stops a failing or cross-process (OpenCode) agent run from aborting the
 * workflow transaction, and lets the separate mcp:serve-http process see the
 * committed per-run session rows it needs to authenticate submit_outcome.
 *
 * Idempotency: the agent must run exactly once and only after the step parks.
 * The guard below enforces both (skip when the step already advanced; retry when
 * not yet PAUSED). Once the agent has run, a resume failure is logged rather than
 * rethrown so the job is NOT retried — re-running an auto_approved agent would
 * re-execute its effector.
 */
export async function handleInvokeAgentJob(
  em: EntityManager,
  container: AwilixContainer,
  payload: WorkflowActivityJobInvokeAgent,
  attempt: { attemptNumber: number; maxAttempts: number } = {
    attemptNumber: 1,
    maxAttempts: INVOKE_AGENT_QUEUE_MAX_ATTEMPTS,
  },
): Promise<void> {
  const instance = await em.findOne(WorkflowInstance, {
    id: payload.workflowInstanceId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })
  if (!instance) {
    // The parking transaction may not be visible yet — retry.
    throw new Error(
      `Workflow instance ${payload.workflowInstanceId} not found for invoke_agent job`
    )
  }

  if (instance.currentStepId !== payload.stepId) {
    logger.info('invoke_agent job skipped — instance is on a different step (already resolved)', {
      workflowInstanceId: payload.workflowInstanceId,
      currentStepId: instance.currentStepId,
      stepId: payload.stepId,
    })
    return
  }
  if (instance.status !== 'PAUSED') {
    // Parking transaction has not committed yet; retry before running the agent.
    throw new Error(
      `invoke_agent: instance ${payload.workflowInstanceId} not parked yet (status=${instance.status}); retrying`
    )
  }

  let bridge: AgentWorkflowBridgeLike
  try {
    bridge = container.resolve<AgentWorkflowBridgeLike>('agentWorkflowBridge')
  } catch {
    throw new Error('[internal] agent_orchestrator not installed (agentWorkflowBridge unavailable)')
  }

  let outcome: Awaited<ReturnType<AgentWorkflowBridgeLike['invokeAgentForWorkflow']>>
  try {
    outcome = await bridge.invokeAgentForWorkflow({
      agentId: payload.agentId,
      input: payload.input,
      onResult: payload.onResult,
      ctx: {
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
        userId: payload.userId,
        processId: instance.id,
        stepId: payload.stepId,
        ...(payload.subject ? { subject: payload.subject } : {}),
        ...(payload.review ? { review: payload.review } : {}),
        // Spread conditionally, like every other optional field on this ctx: a
        // step with no mapping must hand the bridge exactly the object it handed
        // it before this line existed, not one carrying an explicit `undefined`.
        ...(payload.outputMapping ? { outputMapping: payload.outputMapping } : {}),
      },
    })
  } catch (agentError: unknown) {
    // Transient capacity rejection (structural `retryable: true`, e.g. the
    // enterprise AgentCapacityError): the agent never ran, so rethrow and let
    // the queue's retry/backoff re-attempt instead of fail-stopping the step.
    // The terminal attempt becomes the declarative `error` outcome when this
    // step opted into outcome routing; legacy steps keep their fail-stop.
    if (isRetryableError(agentError) && attempt.attemptNumber < attempt.maxAttempts) {
      logger.warn('invoke_agent rejected by capacity; rethrowing for queue retry', {
        agentId: payload.agentId,
        workflowInstanceId: payload.workflowInstanceId,
        error: agentError instanceof Error ? agentError.message : String(agentError),
      })
      throw agentError
    }
    // Guardrail escalation (spec 7.3). A guardrail `block` is a GOVERNANCE
    // outcome, not an infra failure: when the step wired the `guardrailBlocked`
    // handle, resume it down that route (typically → a review task carrying the
    // guardrail evidence REFERENCE — never the evidence blob, which stays on the
    // AgentGuardrailCheck row). A step that wired no such route keeps the
    // fail-stop below byte-for-byte, so nothing changes until an author opts in.
    if (isGuardrailBlockedError(agentError)) {
      const routed = await resumeInvokeAgentWithGuardrailBlock(em, container, instance, payload, agentError)
      if (routed) return
    } else {
      const routed = await resumeInvokeAgentWithError(em, container, instance, payload, agentError)
      if (routed) return
    }

    // Fail-stop: an INVOKE_AGENT step whose agent cannot produce an outcome
    // (unknown agent id, run error, an unwired guardrail block) must HALT the
    // instance, not
    // silently retry the job forever while the step stays parked. Mark the parked
    // step + instance FAILED so progression stops and the failure is visible, and
    // do NOT rethrow — a retry would never succeed and would re-run any partial
    // agent work. (A genuine human-review pause is the `user_task` branch below,
    // which is unaffected.)
    await failInvokeAgentStep(em, container, instance, payload, agentError)
    return
  }

  // user_task: leave the step parked — agent_orchestrator's human dispose path
  // fires the same proposal-ready signal to resume it (unchanged behavior).
  if (outcome.kind === 'user_task') {
    logger.info('invoke_agent routed to human; leaving instance parked', {
      agentId: payload.agentId,
      proposalId: outcome.proposalId,
      workflowInstanceId: payload.workflowInstanceId,
    })
    return
  }

  // suspended: the agent started but will answer out of band (an external
  // runtime whose provider calls back later). Nothing has been produced to map,
  // so leave the step parked exactly like `user_task` — the callback resumes it
  // by firing the same proposal-ready signal. Firing a signal here would advance
  // the run down the researcher handle with an empty payload.
  if (outcome.kind === 'suspended') {
    logger.info('invoke_agent suspended; leaving instance parked until the external run answers', {
      agentId: payload.agentId,
      runId: outcome.runId,
      workflowInstanceId: payload.workflowInstanceId,
    })
    return
  }

  // researcher / auto_approved: resume the parked step by firing the signal. The
  // payload is merged into workflow context (top-level), mirroring the prior
  // inline-resolution behavior so the outgoing transition can branch. When the
  // activity declared an outputMapping, route the result into the chosen keys;
  // otherwise fall back to the legacy fixed-key payload.
  // `auto_approved` and `none_proposed` both carry the proposal; only `researcher`
  // carries agent data. Narrowed explicitly rather than through a boolean, which the
  // discriminated union does not follow.
  const proposalOutcome = outcome.kind === 'researcher' ? null : outcome
  const mappedPayload = mapAgentResultToContext(
    {
      kind: outcome.kind,
      agentId: payload.agentId,
      proposalId: proposalOutcome?.proposalId,
      proposalPayload: proposalOutcome?.payload,
      data: outcome.kind === 'researcher' ? outcome.data : undefined,
    },
    payload.outputMapping
  )
  const signalPayload =
    mappedPayload ??
    (proposalOutcome
      ? {
          disposition: proposalOutcome.kind,
          agentId: payload.agentId,
          agentProposalId: proposalOutcome.proposalId,
          proposalPayload: proposalOutcome.payload,
        }
      : {
          disposition: 'researcher',
          agentId: payload.agentId,
          [`${payload.stepId}_agent`]: outcome.kind === 'researcher' ? outcome.data : undefined,
        })

  try {
    const { sendSignal } = await import('./signal-handler')
    await sendSignal(em, container, {
      instanceId: payload.workflowInstanceId,
      signalName: payload.signalName,
      payload: signalPayload,
      // `none_proposed` takes the researcher handle — the agent looked and reported
      // nothing, which is what that route means.
      agentOutcome: outcome.kind === 'auto_approved' ? 'approved' : 'researcher',
      agentProposalId: proposalOutcome?.proposalId,
      userId: payload.userId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
  } catch (resumeError: unknown) {
    // The agent already ran (and, for auto_approved, its effector already
    // executed). Re-running on retry would double-execute, so do NOT rethrow:
    // log and leave the instance parked (resumable via a manual signal).
    logger.error('invoke_agent ran but resume failed; left parked', {
      agentId: payload.agentId,
      workflowInstanceId: payload.workflowInstanceId,
      error: resumeError instanceof Error ? resumeError.message : String(resumeError),
    })
  }
}

/**
 * Resume a parent instance parked on a SUB_WORKFLOW step after its child reached
 * a terminal state. Modelled on `handleInvokeAgentJob`:
 *
 * Idempotency / ordering guards (mirror handleInvokeAgentJob):
 *   - parent not found → throw (parking txn may not be visible yet; retry)
 *   - parent.currentStepId !== parentStepId → already advanced or never parked
 *     here (synchronous fast path) → skip (no retry)
 *   - parent.status !== 'PAUSED' → not parked yet → throw (retry)
 *
 * A COMPLETED child maps its output (shared mapSubWorkflowOutput helper) and
 * resumes via `sendSignal`. A FAILED child fails the parent. Once the resume work
 * has run, a resume failure is logged rather than rethrown so a retry cannot
 * double-execute side effects.
 */
export async function resumeParentAfterSubWorkflow(
  em: EntityManager,
  container: AwilixContainer,
  payload: WorkflowActivityJobResumeSubWorkflowParent
): Promise<void> {
  const { parentInstanceId, parentStepId, parentStepInstanceId, childInstanceId, childStatus, tenantId, organizationId } =
    payload

  const parent = await em.findOne(WorkflowInstance, {
    id: parentInstanceId,
    tenantId,
    organizationId,
  })
  if (!parent) {
    // The parking transaction may not be visible yet — retry.
    throw new Error(`Parent workflow instance ${parentInstanceId} not found for resume_subworkflow_parent job`)
  }

  if (parent.currentStepId !== parentStepId) {
    logger.info(
      'resume_subworkflow_parent skipped — parent is on a different step (already resolved or synchronous fast path)',
      { parentInstanceId, currentStepId: parent.currentStepId, parentStepId },
    )
    return
  }
  if (parent.status !== 'PAUSED') {
    // Parking transaction has not committed yet; retry before resuming.
    throw new Error(
      `resume_subworkflow_parent: parent ${parentInstanceId} not parked yet (status=${parent.status}); retrying`
    )
  }

  const { completeWorkflow } = await import('./workflow-executor')

  const failParent = async (error: string): Promise<void> => {
    const activeStep = await em.findOne(StepInstance, {
      workflowInstanceId: parentInstanceId,
      stepId: parentStepId,
      status: 'ACTIVE',
    })
    if (activeStep) {
      const now = new Date()
      activeStep.status = 'FAILED'
      activeStep.errorData = { error }
      activeStep.exitedAt = now
      activeStep.updatedAt = now
      await em.flush()
    }
    await completeWorkflow(em, container, parentInstanceId, 'FAILED', { error })
  }

  if (childStatus === 'FAILED') {
    const message = `Sub-workflow child ${childInstanceId} failed`
    await logWorkflowEvent(em, {
      workflowInstanceId: parentInstanceId,
      stepInstanceId: parentStepInstanceId,
      eventType: 'SUB_WORKFLOW_FAILED',
      eventData: { childInstanceId, error: message },
      tenantId,
      organizationId,
    })
    await failParent(message)
    return
  }

  // COMPLETED child: map its output against the SUB_WORKFLOW step's outputMapping
  // and the child's declared io output ports.
  const parentDefinition = await em.findOne(WorkflowDefinition, { id: parent.definitionId })
  const stepDef = parentDefinition?.definition.steps.find((s: any) => s.stepId === parentStepId)
  const { subWorkflowId, outputMapping, version } = (stepDef?.config || {}) as {
    subWorkflowId?: string
    outputMapping?: Record<string, string>
    version?: number
  }

  const childInstance = await em.findOne(WorkflowInstance, {
    id: childInstanceId,
    tenantId,
    organizationId,
  })
  if (!childInstance) {
    throw new Error(`Child workflow instance ${childInstanceId} not found for resume_subworkflow_parent job`)
  }

  const { findWorkflowDefinition } = await import('./find-definition')
  const childDefinition = subWorkflowId
    ? await findWorkflowDefinition(em, { workflowId: subWorkflowId, version, tenantId, organizationId })
    : null
  const ioContract = (childDefinition?.definition as { io?: WorkflowIoContract } | undefined)?.io

  const { mapSubWorkflowOutput } = await import('./step-handler')
  const mapped = mapSubWorkflowOutput(childInstance.context || {}, outputMapping || {}, ioContract)

  if (mapped.error) {
    await logWorkflowEvent(em, {
      workflowInstanceId: parentInstanceId,
      stepInstanceId: parentStepInstanceId,
      eventType: 'SUB_WORKFLOW_FAILED',
      eventData: { childInstanceId, reason: 'OUTPUT_VALIDATION', error: mapped.error },
      tenantId,
      organizationId,
    })
    await failParent(mapped.error)
    return
  }

  const outputData = mapped.outputData

  await logWorkflowEvent(em, {
    workflowInstanceId: parentInstanceId,
    stepInstanceId: parentStepInstanceId,
    eventType: 'SUB_WORKFLOW_COMPLETED',
    eventData: { childInstanceId, outputData },
    tenantId,
    organizationId,
  })

  // Resume the parent via sendSignal: merges outputData into context, exits the
  // active SUB_WORKFLOW step, runs the auto transition out of it, and resumes
  // executeWorkflow(parent). After this side-effecting work, a failure is logged
  // rather than rethrown to avoid double-execution on retry.
  try {
    const { sendSignal } = await import('./signal-handler')
    await sendSignal(em, container, {
      instanceId: parentInstanceId,
      signalName: SUB_WORKFLOW_SIGNAL_NAME,
      payload: outputData,
      userId: payload.userId,
      tenantId,
      organizationId,
    })
  } catch (resumeError: unknown) {
    logger.error('resume_subworkflow_parent: child completed but resuming parent failed; left parked', {
      childInstanceId,
      parentInstanceId,
      error: resumeError instanceof Error ? resumeError.message : String(resumeError),
    })
  }
}

/**
 * Resume a parked agent step through declarative outcome handling.
 *
 * Returns false — leaving the caller's legacy fail-stop to run — when the step
 * declares no outcome routing at all. Once a step opts in, an unwired outcome
 * is still resumed so the executor can apply the inherited error directive.
 */
async function resumeInvokeAgentWithOutcome(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  payload: WorkflowActivityJobInvokeAgent,
  outcome: AgentOutcomeKind,
  contextPayload: Record<string, unknown>,
): Promise<boolean> {
  let definition: { definition?: OutcomeRoutingDefinitionLike } | null = null
  try {
    const { findDefinitionForInstance } = await import('./find-definition')
    definition = await findDefinitionForInstance(em, instance)
  } catch {
    return false
  }
  if (!definition?.definition) return false
  if (listWiredOutcomes(definition.definition, payload.stepId).length === 0) return false

  try {
    const { sendSignal } = await import('./signal-handler')
    await sendSignal(em, container, {
      instanceId: payload.workflowInstanceId,
      signalName: payload.signalName,
      payload: contextPayload,
      agentOutcome: outcome,
      userId: payload.userId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
    return true
  } catch (resumeError: unknown) {
    logger.error('invoke_agent outcome could not be routed; falling back to fail-stop', {
      agentId: payload.agentId,
      outcome,
      workflowInstanceId: payload.workflowInstanceId,
      error: resumeError instanceof Error ? resumeError.message : String(resumeError),
    })
    return false
  }
}

async function resumeInvokeAgentWithGuardrailBlock(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  payload: WorkflowActivityJobInvokeAgent,
  agentError: unknown,
): Promise<boolean> {
  const evidenceRef = readGuardrailBlockEvidenceRef(agentError)
  return resumeInvokeAgentWithOutcome(em, container, instance, payload, 'guardrailBlocked', {
    disposition: 'guardrail_blocked',
    agentId: payload.agentId,
    [WORKFLOW_GUARDRAIL_BLOCK_CONTEXT_KEY]: { stepId: payload.stepId, ...evidenceRef },
  })
}

async function resumeInvokeAgentWithError(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  payload: WorkflowActivityJobInvokeAgent,
  agentError: unknown,
): Promise<boolean> {
  const message = agentError instanceof Error ? agentError.message : String(agentError)
  return resumeInvokeAgentWithOutcome(em, container, instance, payload, 'error', {
    agentId: payload.agentId,
    [WORKFLOW_ERROR_CONTEXT_KEY]: buildErrorContextEntry(payload.stepId, message),
  })
}

async function failInvokeAgentStep(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  payload: WorkflowActivityJobInvokeAgent,
  agentError: unknown,
): Promise<void> {
  const message = agentError instanceof Error ? agentError.message : String(agentError)
  logger.error('invoke_agent failed; failing instance', {
    agentId: payload.agentId,
    workflowInstanceId: payload.workflowInstanceId,
    error: message,
  })
  try {
    const { StepInstance } = await import('../data/entities')
    const stepInstance = await em.findOne(StepInstance, {
      id: payload.stepInstanceId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
    if (stepInstance && stepInstance.status === 'ACTIVE') {
      stepInstance.status = 'FAILED'
      stepInstance.errorData = { agentId: payload.agentId, error: message }
      stepInstance.exitedAt = new Date()
      await em.flush()
    }

    const { completeWorkflow } = await import('./workflow-executor')
    await completeWorkflow(em, container, payload.workflowInstanceId, 'FAILED', {
      error: `INVOKE_AGENT step ${payload.stepId} failed: ${message}`,
      details: { agentId: payload.agentId, stepId: payload.stepId },
    })
  } catch (failError: any) {
    logger.error('invoke_agent: could not mark instance FAILED', {
      agentId: payload.agentId,
      workflowInstanceId: payload.workflowInstanceId,
      error: failError?.message ?? String(failError),
    })
  }
}

/**
 * Helper to check if workflow can resume after activities complete/fail
 */
async function checkAndResumeWorkflow(
  em: EntityManager,
  container: AwilixContainer,
  workflowInstanceId: string
): Promise<void> {
  // Import here to avoid circular dependency
  const { resumeWorkflowAfterActivities } = await import('./workflow-executor')


  try {
    await resumeWorkflowAfterActivities(em, container, workflowInstanceId)
  } catch (error: any) {
    // Ignore error if workflow not ready to resume yet
    if (!error.message?.includes('Activities still pending')) {
      logger.error('Failed to resume workflow', { instanceId: workflowInstanceId, err: error })
    }
  }
}
