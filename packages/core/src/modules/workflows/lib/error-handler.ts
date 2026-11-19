/**
 * Workflows Module - Workflow-level Error Handler
 *
 * The definition-level catch-all of spec 5.9, implemented as an ENGINE
 * CONSTRUCT: `completeWorkflow`'s FAILED branch schedules the designated handler
 * before compensation runs, and a queue worker starts it as a sub-workflow with
 * `{ failedStepId, error, contextSnapshot }` as its initial context. It is
 * deliberately NOT an event trigger — the trigger subscriber excludes
 * `workflows.*` events.
 *
 * Durability: `ERROR_HANDLER_SCHEDULED` is written inside the failing
 * transaction, so the intent survives even if the enqueue is lost; the queue
 * carries the execution. Running the handler out of band keeps a handler failure
 * from poisoning the transaction that is recording the original failure, and
 * releases the instance row lock first.
 *
 * Recursion guard: handler instances carry `metadata.errorHandler.depth`, which
 * is engine-owned (unlike context, which the context PATCH API exposes). A
 * handler that fails cannot schedule another handler.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { WorkflowInstance } from '../data/entities'
import { logWorkflowEvent } from './event-logger'
import { readWorkflowErrorHandler } from './error-routing'
import { findDefinitionForInstance } from './find-definition'
import type { WorkflowActivityJob, WorkflowActivityJobErrorHandler } from './activity-queue-types'
import { WORKFLOW_ACTIVITIES_QUEUE_NAME } from './activity-queue-types'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows').child({ component: 'error-handler' })

/** One level of handling: a handler that fails is never handled by a handler. */
export const WORKFLOW_MAX_ERROR_HANDLER_DEPTH = 1

export interface WorkflowErrorHandlerFailure {
  failedStepId?: string | null
  error?: string | null
  details?: unknown
}

export function readErrorHandlerDepth(instance: WorkflowInstance): number {
  const depth = instance.metadata?.errorHandler?.depth
  return typeof depth === 'number' && Number.isFinite(depth) ? depth : 0
}

/**
 * Schedule the definition-level handler sub-workflow for a failing instance.
 * Best-effort like `enqueueSubWorkflowParentResume`: a queue hiccup must never
 * undo the failure that is being recorded. Called BEFORE compensation so the
 * snapshot describes the state that actually failed.
 */
export async function scheduleWorkflowErrorHandler(
  em: EntityManager,
  instance: WorkflowInstance,
  failure: WorkflowErrorHandlerFailure
): Promise<boolean> {
  const definition = await findDefinitionForInstance(em, instance)
  const handler = readWorkflowErrorHandler(definition?.definition)
  if (!handler || !('workflowId' in handler)) return false

  const failedStepId = failure.failedStepId || instance.currentStepId || null
  const depth = readErrorHandlerDepth(instance)

  if (depth >= WORKFLOW_MAX_ERROR_HANDLER_DEPTH) {
    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      eventType: 'ERROR_HANDLER_SKIPPED',
      eventData: {
        reason: 'MAX_DEPTH',
        depth,
        maxDepth: WORKFLOW_MAX_ERROR_HANDLER_DEPTH,
        handlerWorkflowId: handler.workflowId,
        failedStepId,
      },
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })
    return false
  }

  const contextSnapshot = { ...(instance.context || {}) }

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: 'ERROR_HANDLER_SCHEDULED',
    eventData: {
      handlerWorkflowId: handler.workflowId,
      handlerVersion: handler.version,
      failedStepId,
      error: failure.error ?? null,
      depth: depth + 1,
    },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  const job: WorkflowActivityJobErrorHandler = {
    kind: 'workflow_error_handler',
    workflowInstanceId: instance.id,
    handlerWorkflowId: handler.workflowId,
    handlerVersion: handler.version,
    failedStepId,
    error: failure.error ?? null,
    contextSnapshot,
    depth: depth + 1,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  }

  try {
    const { createModuleQueue } = await import('@open-mercato/queue')
    const queue = createModuleQueue<WorkflowActivityJob>(WORKFLOW_ACTIVITIES_QUEUE_NAME, {
      concurrency: parseInt(process.env.WORKFLOW_WORKER_CONCURRENCY || '5'),
    })
    await queue.enqueue(job)
  } catch (error) {
    logger.error('Failed to enqueue workflow error handler', {
      instanceId: instance.id,
      handlerWorkflowId: handler.workflowId,
      err: error,
    })
    return false
  }

  return true
}

/**
 * Worker side: start the handler workflow with the failure triple as its input
 * context, on the worker's own EntityManager. The depth marker rides the child's
 * metadata so a failing handler cannot schedule another one.
 */
export async function runWorkflowErrorHandler(
  em: EntityManager,
  container: AwilixContainer,
  payload: WorkflowActivityJobErrorHandler
): Promise<string | null> {
  const failedInstance = await em.findOne(WorkflowInstance, {
    id: payload.workflowInstanceId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })
  if (!failedInstance) {
    logger.warn('Error handler job references an unknown instance', {
      instanceId: payload.workflowInstanceId,
    })
    return null
  }

  const { startWorkflow, executeWorkflow } = await import('./workflow-executor')

  const handlerInstance = await startWorkflow(em, {
    workflowId: payload.handlerWorkflowId,
    version: payload.handlerVersion,
    initialContext: {
      failedStepId: payload.failedStepId,
      error: payload.error,
      contextSnapshot: payload.contextSnapshot,
    },
    metadata: {
      labels: {
        errorHandlerForInstanceId: payload.workflowInstanceId,
      },
      errorHandler: {
        depth: payload.depth,
        forInstanceId: payload.workflowInstanceId,
        forStepId: payload.failedStepId ?? undefined,
      },
    },
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })

  await logWorkflowEvent(em, {
    workflowInstanceId: payload.workflowInstanceId,
    eventType: 'ERROR_HANDLER_STARTED',
    eventData: {
      handlerInstanceId: handlerInstance.id,
      handlerWorkflowId: payload.handlerWorkflowId,
      failedStepId: payload.failedStepId,
      depth: payload.depth,
    },
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })

  await executeWorkflow(em, container, handlerInstance.id)

  return handlerInstance.id
}
