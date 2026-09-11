/**
 * Failure-queue bulk replay (spec §8.4) — "bulk retry/cancel runs through the
 * progress module".
 *
 * The work runs in a queue worker rather than in the request, per
 * `progress/AGENTS.md` MUST rules: replaying 500 parked instances re-executes
 * 500 workflows, which cannot happen inside an HTTP handler and must survive
 * the operator navigating away.
 *
 * One instance failing must NEVER abort the batch — that is the whole point of
 * a triage surface. Every outcome is counted and the summary reports how many
 * were replayed, skipped and errored.
 */

import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/core'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { WorkflowInstance } from '../data/entities'
import * as workflowExecutor from './workflow-executor'
import { isRetryableRunOutcome, type WorkflowRunOutcome } from './run-outcome'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'

const logger = createLogger('workflows')

export const WORKFLOW_INSTANCE_BULK_REPLAY_QUEUE = 'workflow-instance-bulk-replay'

/** Bound on one batch. Larger sets are triaged by narrowing the error group. */
export const BULK_REPLAY_MAX_IDS = 1000

export type BulkReplayAction = 'retry' | 'cancel'

export type BulkReplayScope = {
  tenantId: string
  organizationId: string
  userId?: string | null
}

export type BulkReplayJobPayload = {
  progressJobId: string
  action: BulkReplayAction
  ids: string[]
  scope: BulkReplayScope
}

export type BulkReplaySummary = {
  action: BulkReplayAction
  requestedCount: number
  affectedCount: number
  skippedCount: number
  failedCount: number
}

let queueInstance: Queue<Record<string, unknown>> | null = null

export function getBulkReplayQueue(): Queue<Record<string, unknown>> {
  if (!queueInstance) {
    queueInstance = createModuleQueue<Record<string, unknown>>(WORKFLOW_INSTANCE_BULK_REPLAY_QUEUE, {
      // Replay re-executes real workflows; one at a time keeps a bulk retry
      // from becoming its own load spike.
      concurrency: 1,
    })
  }
  return queueInstance
}

/** Statuses each action is allowed to act on, mirroring the single-instance routes. */
const RETRYABLE_STATUSES = new Set(['FAILED', 'PAUSED'])
const CANCELLABLE_STATUSES = new Set(['RUNNING', 'PAUSED', 'WAITING_FOR_ACTIVITIES', 'FORKED'])

/**
 * `outcome` is optional so every existing caller keeps compiling; passing it is
 * what makes the "a `partial_failure` is not retryable as a whole run" decision
 * (maintainer, 2026-07-30) EXPLICIT here rather than incidental. A
 * `partial_failure` is COMPLETED, so the status gate already refuses it — but a
 * later widening of `RETRYABLE_STATUSES` must not silently start replaying a
 * run whose successful half the replay would duplicate. Recovery is
 * rerun-from-step on the specific failed step.
 *
 * A null outcome (still running, or a row written before outcomes existed) is
 * never read as a refusal — only the status decides for those.
 */
export function canApplyBulkReplay(
  action: BulkReplayAction,
  status: string,
  outcome?: WorkflowRunOutcome | null
): boolean {
  if (action === 'cancel') return CANCELLABLE_STATUSES.has(status)
  if (!RETRYABLE_STATUSES.has(status)) return false
  if (outcome != null && !isRetryableRunOutcome(outcome)) return false
  return true
}

async function retryInstance(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance
): Promise<void> {
  // A parked instance carries an engine-owned attention marker; clearing it is
  // what takes it out of the failure queue. It is deliberately cleared BEFORE
  // execution so a replay that parks again re-marks it honestly.
  if (instance.metadata?.attention) {
    instance.metadata = { ...instance.metadata, attention: null }
  }
  instance.status = 'RUNNING'
  instance.retryCount = (instance.retryCount || 0) + 1
  instance.errorMessage = null
  instance.errorDetails = null
  instance.updatedAt = new Date()
  await em.flush()

  await workflowExecutor.executeWorkflow(em, container, instance.id)
}

export async function runBulkReplay(params: {
  container: AwilixContainer
  progressJobId: string
  action: BulkReplayAction
  ids: readonly string[]
  scope: BulkReplayScope
}): Promise<BulkReplaySummary> {
  const { container, progressJobId, action, ids, scope } = params
  const em = container.resolve('em') as EntityManager
  const progressService = container.resolve('progressService') as ProgressService
  const progressContext: ProgressServiceContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: scope.userId ?? null,
  }

  await progressService.startJob(progressJobId, progressContext)
  await progressService.updateProgress(
    progressJobId,
    { totalCount: ids.length, processedCount: 0 },
    progressContext
  )

  let affectedCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (const [index, instanceId] of ids.entries()) {
    try {
      // Re-read under the caller's tenant + organization on every iteration:
      // an id that belongs to another tenant resolves to nothing and is
      // skipped, never acted on.
      const instance = await em.findOne(WorkflowInstance, {
        id: instanceId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      if (!instance || !canApplyBulkReplay(action, instance.status, instance.outcome ?? null)) {
        skippedCount += 1
      } else if (action === 'retry') {
        await retryInstance(em, container, instance)
        affectedCount += 1
      } else {
        await workflowExecutor.completeWorkflow(em, container, instance.id, 'CANCELLED')
        affectedCount += 1
      }
    } catch (error) {
      // One bad instance must not abort a triage batch.
      failedCount += 1
      logger.error('Bulk replay failed for instance', { instanceId, action, err: error })
    }

    await progressService.updateProgress(
      progressJobId,
      { totalCount: ids.length, processedCount: index + 1 },
      progressContext
    )
  }

  const summary: BulkReplaySummary = {
    action,
    requestedCount: ids.length,
    affectedCount,
    skippedCount,
    failedCount,
  }

  await progressService.completeJob(progressJobId, { resultSummary: summary }, progressContext)
  return summary
}
