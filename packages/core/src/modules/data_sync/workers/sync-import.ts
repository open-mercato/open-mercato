import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { ProgressService } from '../../progress/lib/progressService'
import type { SyncEngine } from '../lib/sync-engine'
import type { SyncRunService } from '../lib/sync-run-service'
import {
  DATA_SYNC_IMPORT_QUEUE,
  DATA_SYNC_LOCK_DURATION_MS,
  DATA_SYNC_MAX_STALLED_COUNT,
} from '../lib/queue-policy'
import { failAbandonedRun } from '../lib/abandoned-run'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('data_sync').child({ component: 'sync-import' })

type SyncJobPayload = {
  runId: string
  batchSize: number
  scope: {
    organizationId: string
    tenantId: string
    userId?: string | null
  }
}

export const metadata: WorkerMeta = {
  queue: DATA_SYNC_IMPORT_QUEUE,
  id: 'data-sync:import',
  concurrency: 5,
  lockDuration: DATA_SYNC_LOCK_DURATION_MS,
  maxStalledCount: DATA_SYNC_MAX_STALLED_COUNT,
  // Declared on the worker, not on the enqueueing queue: the abandonment this reports is a worker
  // restart, and the process that restarts never constructs the producer's queue instance.
  onJobAbandoned: failAbandonedRun,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<SyncJobPayload>, ctx: HandlerContext): Promise<void> {
  try {
    const engine = ctx.resolve<SyncEngine>('dataSyncEngine')
    await engine.runImport(job.payload.runId, job.payload.batchSize, job.payload.scope)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Data sync import worker failed'
    const errorStack = error instanceof Error ? error.stack : undefined

    try {
      const syncRunService = ctx.resolve<SyncRunService>('dataSyncRunService')
      const progressService = ctx.resolve<ProgressService>('progressService')
      const run = await syncRunService.getRun(job.payload.runId, job.payload.scope)

      if (run && run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled') {
        await syncRunService.markStatus(run.id, 'failed', job.payload.scope, message)
        if (run.progressJobId) {
          await progressService.failJob(
            run.progressJobId,
            {
              errorMessage: message,
              errorStack,
            },
            job.payload.scope,
          )
        }
      }
    } catch (finalizeError) {
      logger.error('Failed to finalize crashed import worker job', { err: finalizeError })
    }

    throw error
  }
}
