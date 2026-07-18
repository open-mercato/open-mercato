import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ProgressService, ProgressServiceContext } from '@open-mercato/core/modules/progress/lib/progressService'
import { MrpRun } from '../../data/entities.js'
import { loadMrpInputs } from './loaders.js'
import { runMrp } from './engine.js'
import { persistMrpSuggestions } from './persistSuggestions.js'
import { emitProductionEvent } from '../../events.js'

/**
 * Task 5.2 — the MRP run worker's business logic (spec § MRP engine, point 4
 * "worker contract"), factored out of `workers/mrp-run.worker.ts` so it can
 * be exercised directly in tests with a mocked container (mirrors
 * `deleteCatalogProductsWithProgress` in `catalog/lib/bulkDelete.ts`).
 *
 * Phases, each reflected via `progressService` so the top-bar `ProgressJob`
 * shows real movement (spec decision c):
 *   1. `startJob` — run flips `pending -> running`, a `ProgressJob` is
 *      created and linked via `MrpRun.progressJobId`.
 *   2. loading — bulk inputs are loaded (`loadMrpInputs`); progress reports
 *      the demand count as `totalCount`.
 *   3. computing — the pure engine (`runMrp`) explodes/nets demand into
 *      suggestions; progress updates to the suggestion count.
 *   4. persisting — suggestions are written with carry-over
 *      (`persistMrpSuggestions`); progress reports `processedCount`
 *      reaching the total once persistence completes.
 *   5. `completeJob` + `MrpRun.status = 'completed'` + a `stats` summary,
 *      then `production.mrp_run.completed` (clientBroadcast) is emitted so
 *      the UI can refresh without polling.
 *
 * Failure path: any thrown error marks the run `failed`, calls
 * `progressService.failJob`, and re-throws so the queue's own retry/error
 * handling (worker `metadata`) still applies. `persistMrpSuggestions`
 * guarantees a RETRY of the same run recomputes from scratch (no partial
 * duplicate rows) — see its docstring.
 */

export interface RunMrpJobParams {
  container: Pick<AwilixContainer, 'resolve'>
  mrpRunId: string
  tenantId: string
  organizationId: string
  userId?: string | null
}

export interface RunMrpJobSummary {
  runId: string
  suggestionsInserted: number
  suggestionsOpen: number
  suggestionsCarried: number
  demandsProcessed: number
  levelsExploded: number
  warningsCount: number
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function runMrpJob(params: RunMrpJobParams): Promise<RunMrpJobSummary> {
  const { container, mrpRunId, tenantId, organizationId, userId } = params
  const em = container.resolve<EntityManager>('em').fork()
  const progressService = container.resolve<ProgressService>('progressService')
  const progressCtx: ProgressServiceContext = { tenantId, organizationId, userId: userId ?? null }

  const run = await em.findOne(MrpRun, { id: mrpRunId, tenantId, organizationId, deletedAt: null })
  if (!run) {
    throw new Error(`[internal] MrpRun ${mrpRunId} not found for scope ${tenantId}/${organizationId}`)
  }

  const asOfDate = typeof run.params?.asOfDate === 'string' ? run.params.asOfDate : toIsoDate(new Date())

  const job = await progressService.createJob(
    {
      jobType: 'production.mrp_run',
      name: 'MRP run',
      cancellable: false,
      meta: { mrpRunId },
    },
    progressCtx,
  )

  run.progressJobId = job.id
  run.status = 'running'
  run.startedAt = new Date()
  await em.flush()
  await progressService.startJob(job.id, progressCtx)

  try {
    const inputs = await loadMrpInputs(em, {
      tenantId,
      organizationId,
      asOfDate,
      resolve: container.resolve.bind(container),
    })
    await progressService.updateProgress(
      job.id,
      { totalCount: inputs.demands.length, processedCount: 0 },
      progressCtx,
    )

    const result = runMrp(inputs)
    await progressService.updateProgress(
      job.id,
      { totalCount: result.suggestions.length, processedCount: 0 },
      progressCtx,
    )

    const persistSummary = await persistMrpSuggestions({
      em,
      runId: run.id,
      tenantId,
      organizationId,
      suggestions: result.suggestions,
    })

    await progressService.updateProgress(
      job.id,
      { totalCount: result.suggestions.length, processedCount: result.suggestions.length },
      progressCtx,
    )

    const stats = {
      demandsProcessed: result.stats.demandsProcessed,
      levelsExploded: result.stats.levelsExploded,
      suggestionsInserted: persistSummary.inserted,
      suggestionsOpen: persistSummary.openCount,
      suggestionsCarried: persistSummary.carriedCount,
      suggestionsSupersededFromPriorRun: persistSummary.supersededPriorOpenCount,
      warningsCount: result.warnings.length,
    }

    run.status = 'completed'
    run.finishedAt = new Date()
    run.stats = stats
    await em.flush()

    await progressService.completeJob(job.id, { resultSummary: stats }, progressCtx)

    await emitProductionEvent(
      'production.mrp_run.completed',
      { id: run.id, tenantId, organizationId, stats },
      { persistent: true },
    )

    return {
      runId: run.id,
      suggestionsInserted: persistSummary.inserted,
      suggestionsOpen: persistSummary.openCount,
      suggestionsCarried: persistSummary.carriedCount,
      demandsProcessed: result.stats.demandsProcessed,
      levelsExploded: result.stats.levelsExploded,
      warningsCount: result.warnings.length,
    }
  } catch (error) {
    run.status = 'failed'
    run.finishedAt = new Date()
    await em.flush()
    await progressService.failJob(
      job.id,
      { errorMessage: error instanceof Error ? error.message : 'MRP run failed' },
      progressCtx,
    )
    throw error
  }
}
