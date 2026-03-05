import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { SyncEngine } from '../lib/sync-engine'

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
  const engine = ctx.resolve<SyncEngine>('dataSyncEngine')
  await engine.runExport(job.payload.runId, job.payload.batchSize, job.payload.scope)
}
