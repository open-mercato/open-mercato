import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { DEAL_MERGE_EFFECTS_QUEUE, markDealMergeEffects, type DealMergeEffectsJob } from '../lib/dealMergeEffects'

export const metadata: WorkerMeta = {
  queue: DEAL_MERGE_EFFECTS_QUEUE,
  id: 'customers:deal-merge-effects',
  concurrency: 1,
}

export default async function handle(job: QueuedJob<DealMergeEffectsJob>, ctx: JobContext & { resolve: <T = unknown>(name: string) => T }): Promise<void> {
  const dataEngine = ctx.resolve<DataEngine>('dataEngine')
  markDealMergeEffects(dataEngine, job.payload)
  await dataEngine.flushOrmEntityChanges()
}
