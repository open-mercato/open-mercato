import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { resumeRun } from '../lib/dispatcher.js'
import { findDueRunIds } from '../lib/runs.js'
import type { ResumeJob } from '../lib/queue.js'
import { buildDispatchDeps, logger, readScope } from './shared.js'
import type { HandlerContext } from './shared.js'
import { reportError } from '@open-mercato/telemetry'

// See the note in dispatch.ts: this string must stay a literal.
export const metadata: WorkerMeta = {
  queue: 'marketing-automation-resume',
  id: 'marketing_automation:resume',
  concurrency: 5,
  // Exposed as a scheduler target so the due-run scan can be driven by a schedule.
  schedulerSafe: true,
  schedulerRequiredFeatures: ['marketing_automation.campaigns.manage'],
}

const SCAN_BATCH = 200

/**
 * Two payload shapes on purpose.
 *
 * `{ runId }` is the targeted, low-latency continuation enqueued the moment a wait parks a run.
 * `{ scope }` is the periodic scan that picks up runs whose delayed job was lost — a Redis
 * flush, a restart mid-delay, a crashed worker. Both go through the same claim, which is what
 * makes running them together safe rather than a double-execution hazard.
 */
export default async function handle(job: QueuedJob<ResumeJob>, ctx: HandlerContext): Promise<void> {
  const scope = readScope(job.payload)
  if (!scope) return

  const deps = buildDispatchDeps(ctx, scope)
  const runId = 'runId' in job.payload ? job.payload.runId : null

  if (runId) {
    const outcome = await resumeRun(runId, deps)
    logger.info('marketing run resumed', { runId, outcome })
    return
  }

  const dueIds = await findDueRunIds(deps.em, scope, deps.now, SCAN_BATCH)
  if (!dueIds.length) return

  let resumed = 0
  for (const id of dueIds) {
    try {
      const outcome = await resumeRun(id, deps)
      if (outcome !== 'skipped') resumed += 1
    } catch (error) {
      // One bad run never aborts the batch; the run's own attempt counter handles its fate.
      logger.error('[internal] marketing run resume failed during scan', {
        runId: id,
        error: error instanceof Error ? error.message : String(error),
      })
      reportError(error, {
        module: 'marketing_automation',
        code: 'marketing_automation.resume_failed',
        attributes: { runId: id },
      })
    }
  }
  logger.info('marketing due-run scan finished', { found: dueIds.length, resumed })
}
