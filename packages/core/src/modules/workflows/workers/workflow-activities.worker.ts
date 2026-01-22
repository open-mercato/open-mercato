/**
 * Workflow Activity Worker
 *
 * Background worker that processes async activities from the workflow queue.
 * Executes activities with timeout, logs events, and triggers workflow resume.
 *
 * This worker is auto-discovered by the queue system and processes jobs from
 * the 'workflow-activities' queue.
 */

import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import { WORKFLOW_ACTIVITIES_QUEUE_NAME, type WorkflowActivityJob } from '../lib/activity-queue-types'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { WorkflowInstance } from '../data/entities'
import { logWorkflowEvent } from '../lib/event-logger'
import {
  executeSendEmail,
  executeCallApi,
  executeEmitEvent,
  executeUpdateEntity,
  executeCallWebhook,
  executeFunction,
} from '../lib/activity-executor'

// Worker metadata for auto-discovery
const DEFAULT_CONCURRENCY = 1
const envConcurrency = process.env.WORKERS_WORKFLOW_ACTIVITIES_CONCURRENCY

export const metadata: WorkerMeta = {
  queue: WORKFLOW_ACTIVITIES_QUEUE_NAME,
  id: 'workflows:workflow-activities',
  concurrency: envConcurrency ? parseInt(envConcurrency, 10) : DEFAULT_CONCURRENCY,
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

/**
 * Process a workflow activity job.
 *
 * This handler:
 * 1. Fetches the workflow instance
 * 2. Executes the activity by type with timeout support
 * 3. Logs success/failure events to workflow event log
 * 4. Attempts to resume the workflow if all activities complete
 *
 * @param job - The queued job containing activity payload
 * @param ctx - Job context with DI container access
 */
export default async function handle(
  job: QueuedJob<WorkflowActivityJob>,
  ctx: JobContext & HandlerContext
): Promise<void> {
  const { payload } = job
  const startTime = Date.now()

  console.log(
    `[workflows:activity-worker] Processing activity ${payload.activityId} (job ${ctx.jobId}, attempt ${ctx.attemptNumber})`
  )

  // Resolve services from DI container
  const em = ctx.resolve<EntityManager>('em')

  // Create a container-like object from ctx.resolve for activity executors
  // The ctx already has the resolve method we need, we just need to cast it
  const container = ctx as unknown as AwilixContainer

  try {
    // Fetch workflow instance with tenant/org scoping
    const instance = await em.findOne(WorkflowInstance, {
      id: payload.workflowInstanceId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })

    if (!instance) {
      throw new Error(
        `Workflow instance ${payload.workflowInstanceId} not found (tenant: ${payload.tenantId}, org: ${payload.organizationId})`
      )
    }

    // Build activity execution context
    const activityContext = {
      workflowInstance: instance,
      workflowContext: payload.workflowContext,
      stepContext: payload.stepContext,
      stepInstanceId: payload.stepInstanceId,
      userId: payload.userId,
    }

    // Execute activity by type
    const executeActivityByType = async () => {
      switch (payload.activityType) {
        case 'SEND_EMAIL':
          return await executeSendEmail(payload.activityConfig, activityContext, container)
        case 'CALL_API':
          return await executeCallApi(
            em,
            payload.activityConfig,
            activityContext,
            container
          )
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
        default:
          throw new Error(`Unsupported activity type: ${payload.activityType}`)
      }
    }

    // Execute with optional timeout
    let result: any
    if (payload.timeoutMs && payload.timeoutMs > 0) {
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

    // Log success event to workflow event log
    await logWorkflowEvent(em, {
      workflowInstanceId: payload.workflowInstanceId,
      stepInstanceId: payload.stepInstanceId,
      eventType: 'ACTIVITY_COMPLETED',
      eventData: {
        activityId: payload.activityId,
        activityName: payload.activityName,
        activityType: payload.activityType,
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
      `[workflows:activity-worker] Activity ${payload.activityId} completed successfully in ${executionTimeMs}ms`
    )

    // Attempt to resume workflow if all activities complete
    await checkAndResumeWorkflow(em, ctx, payload.workflowInstanceId)
  } catch (error: any) {
    const executionTimeMs = Date.now() - startTime

    console.error(
      `[workflows:activity-worker] Activity ${payload.activityId} failed (attempt ${ctx.attemptNumber}):`,
      error.message
    )

    // Log failure event to workflow event log
    await logWorkflowEvent(em, {
      workflowInstanceId: payload.workflowInstanceId,
      stepInstanceId: payload.stepInstanceId,
      eventType: 'ACTIVITY_FAILED',
      eventData: {
        activityId: payload.activityId,
        activityName: payload.activityName,
        activityType: payload.activityType,
        async: true,
        jobId: ctx.jobId,
        attemptNumber: ctx.attemptNumber,
        error: error.message,
        errorStack: error.stack,
        executionTimeMs,
      },
      userId: payload.userId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })

    // Check if this was final attempt (BullMQ handles retries automatically)
    const maxAttempts = payload.retryPolicy?.maxAttempts || 1
    if (ctx.attemptNumber >= maxAttempts) {
      console.error(
        `[workflows:activity-worker] Activity ${payload.activityId} failed after ${maxAttempts} attempts - triggering workflow failure handling`
      )
      // Final failure - attempt to resume workflow (may transition to FAILED state)
      await checkAndResumeWorkflow(em, ctx, payload.workflowInstanceId)
    }

    // Re-throw to let BullMQ handle retry logic
    throw error
  }
}

/**
 * Helper to check if workflow can resume after activities complete/fail.
 *
 * This function is called after each activity completes or fails.
 * It checks if all pending activities are done and resumes workflow execution.
 *
 * @param em - Entity manager
 * @param ctx - Handler context with resolve method for DI
 * @param workflowInstanceId - Workflow instance ID to resume
 */
async function checkAndResumeWorkflow(
  em: EntityManager,
  ctx: HandlerContext,
  workflowInstanceId: string
): Promise<void> {
  // Import here to avoid circular dependency
  const { resumeWorkflowAfterActivities } = await import('../lib/workflow-executor')

  // Cast ctx to AwilixContainer for the resume function
  const container = ctx as unknown as AwilixContainer

  try {
    await resumeWorkflowAfterActivities(em, container, workflowInstanceId)
  } catch (error: any) {
    // Ignore error if workflow not ready to resume yet (activities still pending)
    if (!error.message?.includes('Activities still pending')) {
      console.error(
        `[workflows:activity-worker] Failed to resume workflow ${workflowInstanceId}:`,
        error.message
      )
    }
  }
}
