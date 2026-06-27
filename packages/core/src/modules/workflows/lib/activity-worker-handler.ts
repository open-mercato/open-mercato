/**
 * Workflow Activity Worker Handler
 *
 * Background worker that processes async activities from the queue.
 * Executes activities with timeout, logs events, and triggers workflow resume.
 */

import { JobHandler } from '@open-mercato/queue'
import { WorkflowActivityJob, WorkflowActivityJobInvokeAgent } from './activity-queue-types'
import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { WorkflowInstance } from '../data/entities'
import { logWorkflowEvent } from './event-logger'
import {
  executeSendEmail,
  executeEmitEvent,
  executeUpdateEntity,
  executeCallWebhook,
  executeFunction,
} from './activity-executor'

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
      console.log(
        `[ActivityWorker] Firing timer for instance ${payload.workflowInstanceId} (job ${ctx.jobId})`
      )
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
        console.error(
          `[ActivityWorker] Failed to fire timer for instance ${payload.workflowInstanceId}:`,
          error.message
        )
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

    console.log(
      `[ActivityWorker] Processing activity ${payload.activityId} (job ${ctx.jobId})`
    )

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

      console.log(
        `[ActivityWorker] Activity ${payload.activityId} completed in ${executionTimeMs}ms`
      )

      // Trigger workflow resume check (via event or direct call)
      await checkAndResumeWorkflow(em, container, payload.workflowInstanceId)
    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime

      console.error(`[ActivityWorker] Activity ${payload.activityId} failed:`, error.message)

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

  const outcome = await bridge.invokeAgentForWorkflow({
    agentId: payload.agentId,
    input: payload.input,
    onResult: payload.onResult,
    ctx: {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
      userId: payload.userId,
      processId: instance.id,
      stepId: payload.stepId,
    },
  })

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
  // inline-resolution behavior so the outgoing transition can branch.
  const signalPayload =
    outcome.kind === 'auto_approved'
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
        }

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
      console.error(`[ActivityWorker] Failed to resume workflow ${workflowInstanceId}:`, error)
    }
  }
}
