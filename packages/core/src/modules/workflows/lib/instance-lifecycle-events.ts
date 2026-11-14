import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitWorkflowsEvent } from '../events'
import type { WorkflowInstance, WorkflowInstanceStatus } from '../data/entities'

const logger = createLogger('workflows')

export type InstanceLifecycleEventId =
  | 'workflows.instance.created'
  | 'workflows.instance.started'
  | 'workflows.instance.completed'
  | 'workflows.instance.failed'
  | 'workflows.instance.cancelled'
  | 'workflows.instance.paused'
  | 'workflows.instance.resumed'

/**
 * Publish a declared `workflows.instance.*` lifecycle event to the event bus,
 * alongside (never instead of) the internal `WorkflowEvent` audit row. Delivery
 * is at-least-once and consumers must be idempotent; a bus failure must never
 * break workflow execution, so this is strictly best-effort.
 */
export async function emitInstanceLifecycleEvent(
  instance: WorkflowInstance,
  eventId: InstanceLifecycleEventId,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    await emitWorkflowsEvent(
      eventId,
      {
        id: instance.id,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
        workflowId: instance.workflowId,
        version: instance.version,
        status: instance.status,
        stepId: instance.currentStepId ?? null,
        ...extra,
      },
      { persistent: true }
    )
  } catch (error) {
    logger.error('failed to emit workflow event', {
      eventId,
      instanceId: instance.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Emit `workflows.instance.paused` / `workflows.instance.resumed` for an
 * INSTANCE-level park transition, given the status the instance had before the
 * caller wrote it. Emits only on an actual `→ PAUSED` / `PAUSED → RUNNING`
 * change, so a re-park of an already-parked instance and a branch-only park
 * (the instance stays FORKED) publish nothing.
 */
export async function emitInstanceParkTransition(
  instance: WorkflowInstance,
  previousStatus: WorkflowInstanceStatus
): Promise<void> {
  if (previousStatus !== 'PAUSED' && instance.status === 'PAUSED') {
    await emitInstanceLifecycleEvent(instance, 'workflows.instance.paused')
    return
  }
  if (previousStatus === 'PAUSED' && instance.status === 'RUNNING') {
    await emitInstanceLifecycleEvent(instance, 'workflows.instance.resumed')
  }
}
