/**
 * Workflow Activity Worker Handler
 *
 * Background worker that processes async activities from the queue.
 * Executes activities with timeout, logs events, and triggers workflow resume.
 */

import { JobHandler } from '@open-mercato/queue'
import { WorkflowActivityJob } from './activity-queue-types'
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
 * Helper to check if workflow can resume after activities complete/fail
 */
async function checkAndResumeWorkflow(
  em: EntityManager,
  container: AwilixContainer,
  workflowInstanceId: string
): Promise<void> {
  // Import here to avoid circular dependency
  const { resumeWorkflowAfterActivities } = await import('./workflow-executor')

  console.log(`[ActivityWorker] Attempting to resume workflow ${workflowInstanceId}`)

  try {
    await resumeWorkflowAfterActivities(em, container, workflowInstanceId)
    console.log(`[ActivityWorker] Successfully resumed workflow ${workflowInstanceId}`)
  } catch (error: any) {
    console.log(`[ActivityWorker] Resume error for ${workflowInstanceId}:`, error.message)
    // Ignore error if workflow not ready to resume yet
    if (!error.message?.includes('Activities still pending')) {
      console.error(`[ActivityWorker] Failed to resume workflow ${workflowInstanceId}:`, error)
    }
  }
}
