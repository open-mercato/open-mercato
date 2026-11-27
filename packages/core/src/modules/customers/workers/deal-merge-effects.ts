import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import {
  DEAL_MERGE_EFFECTS_QUEUE,
  markDealMergeEffects,
  resolveDeferredDealMergeEffects,
  type DealMergeEffectsJob,
} from '../lib/dealMergeEffects'

export const metadata: WorkerMeta = {
  queue: DEAL_MERGE_EFFECTS_QUEUE,
  id: 'customers:deal-merge-effects',
  concurrency: 1,
}

export default async function handle(job: QueuedJob<DealMergeEffectsJob>, ctx: JobContext & { resolve: <T = unknown>(name: string) => T }): Promise<void> {
  const dataEngine = ctx.resolve<DataEngine>('dataEngine')
  const em = ctx.resolve<EntityManager>('em').fork()
  const { current, superseded } = await resolveDeferredDealMergeEffects(em, job.payload)
  markDealMergeEffects(dataEngine, current)
  markDealMergeEffects(dataEngine, superseded, { publishEvents: false })
  await dataEngine.flushOrmEntityChanges()
}
