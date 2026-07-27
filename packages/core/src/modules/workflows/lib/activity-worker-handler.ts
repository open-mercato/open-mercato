/**
 * Workflow Activity Worker Handler
 *
 * Background worker that processes async activities from the queue.
 * Executes activities with timeout, logs events, and triggers workflow resume.
 */

import { JobHandler } from '@open-mercato/queue'
import { WorkflowActivityJob, WorkflowActivityJobActivity } from './activity-queue-types'
import { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { WorkflowInstance } from '../data/entities'
import { logWorkflowEvent } from './event-logger'
import './activity-registry-bootstrap'
import type { ActivityContext } from './activity-executor'
import './activity-executor'
import { getActivityType, type ActivityExecuteDeps } from './activity-registry'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows').child({ component: 'activity-worker' })

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
