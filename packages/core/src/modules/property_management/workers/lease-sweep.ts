import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { LEASE_SWEEP_QUEUE } from '../lib/queues'
import { resolveTrustedSweepScope, runLeaseSweep, type SweepScopePayload } from '../lib/leaseSweep'

type LeaseSweepPayload = NonNullable<SweepScopePayload>

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
  container?: AwilixContainer
}

export const metadata: WorkerMeta = {
  queue: LEASE_SWEEP_QUEUE,
  id: 'property_management:lease-sweep',
  concurrency: 1,
}

export default async function handle(job: QueuedJob<LeaseSweepPayload>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const scope = await resolveTrustedSweepScope(em, job.payload, 'lease')
  if (!scope) return
  const container = (ctx.container ?? { resolve: ctx.resolve }) as AwilixContainer
  await runLeaseSweep({ container, em }, scope)
}
