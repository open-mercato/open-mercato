import { raw, type EntityManager } from '@mikro-orm/core'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { WorkflowInstance } from '../data/entities'
import { emitInstanceParkTransition } from './instance-lifecycle-events'

const logger = createLogger('workflows')

/**
 * The parked wait a caller decided to resume, read from the snapshot it loaded
 * BEFORE any write of its own. `waitVersion` tells two occurrences of the same
 * wait apart once a loop brings the run back to the step, exactly as
 * `sendSignal`'s claim uses it.
 */
export type ObservedInstanceWait = {
  stepId: string | null
  waitVersion?: number
}

export function observeInstanceWait(instance: WorkflowInstance): ObservedInstanceWait {
  return {
    stepId: instance.currentStepId ?? null,
    waitVersion: typeof instance.waitVersion === 'number' ? instance.waitVersion : undefined,
  }
}

/**
 * Resume an instance-level PAUSED wait so that exactly one caller wins it.
 *
 * Every resume path reads a snapshot first, so overlapping callers all see the
 * same PAUSED row; only the conditional UPDATE is atomic. It is scoped to the
 * instance's tenant and organization and pinned to the observed step and
 * `waitVersion`, so it also refuses a wait that was cancelled, moved on or
 * re-parked in the meantime. The winner runs `afterClaim` (its own follow-up
 * writes, including their flush) and only then publishes
 * `workflows.instance.resumed`. If `afterClaim` throws, the wait is handed back
 * so the run is not stranded as RUNNING with nothing driving it, and nothing is
 * published.
 *
 * Returns `false` when another caller already won: the caller MUST NOT drive
 * the run and MUST NOT publish.
 */
export async function resumeObservedInstanceWait(
  em: EntityManager,
  instance: WorkflowInstance,
  observed: ObservedInstanceWait,
  afterClaim?: () => Promise<void>,
): Promise<boolean> {
  const now = new Date()
  const claimed = await em.nativeUpdate(
    WorkflowInstance,
    {
      id: instance.id,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
      status: 'PAUSED',
      currentStepId: observed.stepId,
      ...(observed.waitVersion !== undefined ? { waitVersion: observed.waitVersion } : {}),
    },
    { status: 'RUNNING', updatedAt: now, waitVersion: raw('wait_version + 1') },
  )
  if (claimed === 0) return false

  instance.status = 'RUNNING'
  instance.updatedAt = now

  if (afterClaim) {
    try {
      await afterClaim()
    } catch (error) {
      await releaseInstanceResumeClaim(em, instance, observed)
      throw error
    }
  }

  await emitInstanceParkTransition(instance, 'PAUSED')
  return true
}

async function releaseInstanceResumeClaim(
  em: EntityManager,
  instance: WorkflowInstance,
  observed: ObservedInstanceWait,
): Promise<void> {
  instance.status = 'PAUSED'
  try {
    await em.nativeUpdate(
      WorkflowInstance,
      {
        id: instance.id,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
        status: 'RUNNING',
        currentStepId: observed.stepId,
      },
      { status: 'PAUSED', updatedAt: new Date(), waitVersion: raw('wait_version + 1') },
    )
  } catch (releaseError) {
    logger.error('Failed to release instance resume claim', { instanceId: instance.id, err: releaseError })
    try {
      getTelemetryRuntime()?.reportError(releaseError, {
        module: 'workflows',
        code: 'workflows.instance_resume_claim_release_failed',
        attributes: { instanceId: instance.id, stepId: observed.stepId ?? undefined },
      })
    } catch {
      // Reporting is best-effort and must not replace the caller's error.
    }
  }
}
