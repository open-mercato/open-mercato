/**
 * EP-51 — the job shell every registered recalculation runs inside.
 *
 * It owns the `ProgressJob` (start, totals, cancel, complete) and hands each hook
 * a reporter scoped to that job, so N hooks share one progress bar instead of
 * fighting over it. Hooks run **sequentially** and in registry order: they write
 * the same rows, and two of them racing over `staff_time_entries` is the kind of
 * bug that shows up as a wrong invoice a month later.
 *
 * A hook that throws does not silently vanish — the runner logs it and rethrows,
 * because a half-finished restatement the operator believes succeeded is worse
 * than a loud failure. Marking the `ProgressJob` failed is the worker's job: it
 * already does that for every exception that reaches it, and doing it in both
 * places would write the failure twice.
 */

import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ProgressService, ProgressServiceContext } from '../../../progress/lib/progressService'
import {
  emptyRecalculationSummary,
  resolveTimeTrackingRecalculations,
  type TimeTrackingRecalculationScope,
  type TimeTrackingRecalculationSummary,
} from './recalculations'

const logger = createLogger('staff').child({ component: 'time-tracking/recalculation-runner' })

export type TimeTrackingRecalculationRunSummary = TimeTrackingRecalculationSummary & {
  hooks: Array<{ id: string } & TimeTrackingRecalculationSummary>
}

function progressContextFor(scope: TimeTrackingRecalculationScope): ProgressServiceContext {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationIds?.length === 1 ? scope.organizationIds[0] : null,
    userId: scope.userId ?? null,
  }
}

function accumulate(
  target: TimeTrackingRecalculationSummary,
  addend: TimeTrackingRecalculationSummary,
): void {
  target.totalCount += addend.totalCount
  target.processedCount += addend.processedCount
  target.updatedCount += addend.updatedCount
  target.unchangedCount += addend.unchangedCount
  target.skippedCount += addend.skippedCount
  target.cancelled = target.cancelled || addend.cancelled
}

export async function runTimeTrackingRecalculations(params: {
  container: AwilixContainer
  progressJobId: string
  scope: TimeTrackingRecalculationScope
  hookIds?: readonly string[] | null
}): Promise<TimeTrackingRecalculationRunSummary> {
  const { container, progressJobId, scope } = params
  const hooks = resolveTimeTrackingRecalculations(params.hookIds)
  const progressService = container.resolve('progressService') as ProgressService
  const progressContext = progressContextFor(scope)

  await progressService.startJob(progressJobId, progressContext)

  const summary: TimeTrackingRecalculationRunSummary = { ...emptyRecalculationSummary(), hooks: [] }
  let knownTotal = 0
  let processed = 0

  try {
    for (const hook of hooks) {
      const hookSummary = await hook.run({
        container,
        scope,
        report: {
          setTotal: async (total) => {
            knownTotal += total
            await progressService.updateProgress(
              progressJobId,
              { totalCount: knownTotal, processedCount: Math.min(processed, knownTotal) },
              progressContext,
            )
          },
          advance: async (count) => {
            processed += count
            await progressService.updateProgress(
              progressJobId,
              { totalCount: knownTotal, processedCount: Math.min(processed, knownTotal) },
              progressContext,
            )
          },
          isCancellationRequested: () =>
            progressService.isCancellationRequested(
              progressJobId,
              scope.tenantId,
              progressContext.organizationId,
            ),
        },
      })
      summary.hooks.push({ id: hook.id, ...hookSummary })
      accumulate(summary, hookSummary)
      if (hookSummary.cancelled) break
    }
  } catch (err) {
    logger.error('staff.timesheets recalculation failed', { progressJobId, ...summary, err })
    throw err
  }

  if (summary.cancelled) {
    logger.info('staff.timesheets recalculation cancelled', { progressJobId, ...summary })
    await progressService.markCancelled(progressJobId, progressContext)
    return summary
  }

  await progressService.completeJob(progressJobId, { resultSummary: { ...summary } }, progressContext)
  logger.info('staff.timesheets recalculation finished', { progressJobId, ...summary })
  return summary
}
