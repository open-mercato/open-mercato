import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { deleteSimulationRunsOfScope } from './store'

const logger = createLogger('insights').child({ component: 'simulation-scope-purge' })

export type SimulationPurgeContext = {
  resolve: <TService = unknown>(name: string) => TService
}

/**
 * Deletes the simulation runs of a deleted organization (or of every organization of a deleted
 * tenant) and cancels the progress jobs of runs that were still active. Decisions keep their
 * 13-month retention. Idempotent.
 */
export async function purgeSimulationScope(ctx: SimulationPurgeContext, scope: { tenantId: string; organizationId: string | null }): Promise<number> {
  const em = ctx.resolve<EntityManager>('em')
  const runs = await deleteSimulationRunsOfScope(em, scope)
  let progress: ProgressService | null = null
  try {
    progress = ctx.resolve<ProgressService>('progressService')
  } catch {
    progress = null
  }
  for (const job of runs.progressJobIds) {
    if (!progress) break
    try {
      await progress.markCancelled(job.progressJobId, { tenantId: scope.tenantId, organizationId: job.organizationId, userId: null })
    } catch (error) {
      logger.warn('[internal] Could not cancel the progress job of a purged simulation run', { err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_purge_progress_failed' })
    }
  }
  if (runs.deleted > 0) logger.info('Purged the simulation runs of a deleted scope', { tenantId: scope.tenantId, organizationId: scope.organizationId, runs: runs.deleted })
  return runs.deleted
}
