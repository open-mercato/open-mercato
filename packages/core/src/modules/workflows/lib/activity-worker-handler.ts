/**
 * Workflow Activity Worker Handler
 *
 * Background worker that processes async activities from the queue.
 * Executes activities with timeout, logs events, and triggers workflow resume.
 */

import { JobHandler } from '@open-mercato/queue'
import {
  WorkflowActivityJob,
  WorkflowActivityJobInvokeAgent,
  WorkflowActivityJobResumeSubWorkflowParent,
} from './activity-queue-types'
import { mapAgentResultToContext } from './agent-result-mapping'
import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { WorkflowDefinition, WorkflowInstance, StepInstance } from '../data/entities'
import type { WorkflowIoContract } from '../data/validators'
import { logWorkflowEvent } from './event-logger'
import { SUB_WORKFLOW_SIGNAL_NAME } from './activity-executor'
import {
  executeSendEmail,
  executeEmitEvent,
  executeUpdateEntity,
  executeCallWebhook,
  executeFunction,
} from './activity-executor'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows').child({ component: 'activity-worker' })

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

    // Invoke-agent jobs run an INVOKE_AGENT step's agent OUTSIDE the workflow
    // transaction, then resume the parked step (see handleInvokeAgentJob).
    if (payload.kind === 'invoke_agent') {
      await handleInvokeAgentJob(em, container, payload)
      return
    }

    // Resume-parent jobs resume a parent instance parked on a SUB_WORKFLOW step
    // after its child reached a terminal state (see resumeParentAfterSubWorkflow).
    if (payload.kind === 'resume_subworkflow_parent') {
      await resumeParentAfterSubWorkflow(em, container, payload)
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

      const executeActivityByType = async () => {
        switch (payload.activityType) {
          case 'SEND_EMAIL':
            return await executeSendEmail(payload.activityConfig, activityContext, container)
          case 'EMIT_EVENT':
            return await executeEmitEvent(payload.activityConfig, activityContext, container)
          case 'UPDATE_ENTITY':
            return await executeUpdateEntity(
              em,
              payload.activityConfig,
              activityContext,
              container
            )
          case 'CALL_WEBHOOK':
            return await executeCallWebhook(payload.activityConfig, activityContext)
          case 'EXECUTE_FUNCTION':
            return await executeFunction(payload.activityConfig, activityContext, container)
          case 'WAIT':
            // Delay already applied by the queue via delayMs; the worker
            // only needs to record completion so the workflow can resume.
            return { waited: true, async: true }
          default:
            throw new Error(`Unsupported activity type: ${payload.activityType}`)
        }
      }

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
function isRetryableError(err: unknown): boolean {
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
    onResult: { autoApproveThreshold: number } | { alwaysAsk: true }
    ctx: {
      tenantId: string
      organizationId: string
      userId?: string
      processId: string
      stepId: string
      // Optional interpolated business-record descriptor (invokeAgentConfigSchema.subject).
      subject?: unknown
    }
  }) => Promise<
    | { kind: 'informative'; data: unknown }
    | { kind: 'auto_approved'; proposalId: string; payload: unknown }
    | { kind: 'user_task'; proposalId: string }
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
  payload: WorkflowActivityJobInvokeAgent
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
    console.log(
      `[ActivityWorker] invoke_agent job skipped — instance ${payload.workflowInstanceId} current step is ${instance.currentStepId}, not ${payload.stepId} (already resolved)`
    )
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
      },
    })
  } catch (agentError: any) {
    // Transient capacity rejection (structural `retryable: true`, e.g. the
    // enterprise AgentCapacityError): the agent never ran, so rethrow and let
    // the queue's retry/backoff re-attempt instead of fail-stopping the step.
    // Only exhausted retries end the job as failed (the step then stays parked).
    if (isRetryableError(agentError)) {
      console.warn(
        `[ActivityWorker] invoke_agent ${payload.agentId} rejected by capacity for instance ${payload.workflowInstanceId}; rethrowing for queue retry:`,
        agentError?.message
      )
      throw agentError
    }
    // Fail-stop: an INVOKE_AGENT step whose agent cannot produce an outcome
    // (unknown agent id, run error, guardrail block) must HALT the instance, not
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
    console.log(
      `[ActivityWorker] invoke_agent ${payload.agentId} routed to human (proposal ${outcome.proposalId}); leaving instance ${payload.workflowInstanceId} parked`
    )
    return
  }

  // informative / auto_approved: resume the parked step by firing the signal. The
  // payload is merged into workflow context (top-level), mirroring the prior
  // inline-resolution behavior so the outgoing transition can branch. When the
  // activity declared an outputMapping, route the result into the chosen keys;
  // otherwise fall back to the legacy fixed-key payload.
  const mappedPayload = mapAgentResultToContext(
    {
      kind: outcome.kind,
      agentId: payload.agentId,
      proposalId: outcome.kind === 'auto_approved' ? outcome.proposalId : undefined,
      proposalPayload: outcome.kind === 'auto_approved' ? outcome.payload : undefined,
      data: outcome.kind === 'informative' ? outcome.data : undefined,
    },
    payload.outputMapping
  )
  const signalPayload =
    mappedPayload ??
    (outcome.kind === 'auto_approved'
      ? {
          disposition: 'auto_approved',
          agentId: payload.agentId,
          agentProposalId: outcome.proposalId,
          proposalPayload: outcome.payload,
        }
      : {
          disposition: 'informative',
          agentId: payload.agentId,
          [`${payload.stepId}_agent`]: outcome.data,
        })

  try {
    const { sendSignal } = await import('./signal-handler')
    await sendSignal(em, container, {
      instanceId: payload.workflowInstanceId,
      signalName: payload.signalName,
      payload: signalPayload,
      userId: payload.userId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
  } catch (resumeError: any) {
    // The agent already ran (and, for auto_approved, its effector already
    // executed). Re-running on retry would double-execute, so do NOT rethrow:
    // log and leave the instance parked (resumable via a manual signal).
    console.error(
      `[ActivityWorker] invoke_agent ${payload.agentId} ran but resume failed for instance ${payload.workflowInstanceId}; left parked:`,
      resumeError?.message
    )
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
    console.log(
      `[ActivityWorker] resume_subworkflow_parent skipped — parent ${parentInstanceId} current step is ${parent.currentStepId}, not ${parentStepId} (already resolved or synchronous fast path)`
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
  } catch (resumeError: any) {
    console.error(
      `[ActivityWorker] resume_subworkflow_parent: child ${childInstanceId} completed but resuming parent ${parentInstanceId} failed; left parked:`,
      resumeError?.message
    )
  }
}

/**
 * Fail-stop an INVOKE_AGENT step whose agent run threw. Marks the parked step
 * instance FAILED, then fails the whole workflow instance through the shared
 * `completeWorkflow('FAILED')` path (records the error, logs `WORKFLOW_FAILED`,
 * runs compensation if configured). Best-effort and self-contained: any error
 * here is logged, never rethrown, so the queue does not retry an unwinnable job.
 */
async function failInvokeAgentStep(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  payload: WorkflowActivityJobInvokeAgent,
  agentError: unknown,
): Promise<void> {
  const message = agentError instanceof Error ? agentError.message : String(agentError)
  console.error(
    `[ActivityWorker] invoke_agent ${payload.agentId} failed for instance ${payload.workflowInstanceId}; failing instance:`,
    message,
  )
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
    console.error(
      `[ActivityWorker] invoke_agent ${payload.agentId}: could not mark instance ${payload.workflowInstanceId} FAILED:`,
      failError?.message ?? failError,
    )
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
