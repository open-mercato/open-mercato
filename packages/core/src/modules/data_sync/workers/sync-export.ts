import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { ProgressService } from '../../progress/lib/progressService'
import type { SyncEngine } from '../lib/sync-engine'
import type { SyncRunService } from '../lib/sync-run-service'

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
  queue: 'data-sync-export',
  id: 'data-sync:export',
  concurrency: 5,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<SyncJobPayload>, ctx: HandlerContext): Promise<void> {
  try {
    const engine = ctx.resolve<SyncEngine>('dataSyncEngine')
    await engine.runExport(job.payload.runId, job.payload.batchSize, job.payload.scope)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Data sync export worker failed'
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
      console.error('[data-sync] Failed to finalize crashed export worker job:', finalizeError)
    }

    throw error
  }
}
