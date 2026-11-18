import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { BOOKING_SWEEP_QUEUE } from '../lib/queues'
import { runBookingSweep } from '../lib/bookingSweep'
import { resolveTrustedSweepScope, type SweepScopePayload } from '../lib/leaseSweep'

type BookingSweepPayload = NonNullable<SweepScopePayload>

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
  container?: AwilixContainer
}

export const metadata: WorkerMeta = {
  queue: BOOKING_SWEEP_QUEUE,
  id: 'property_management:booking-sweep',
  concurrency: 1,
}

export default async function handle(job: QueuedJob<BookingSweepPayload>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const scope = await resolveTrustedSweepScope(em, job.payload, 'booking')
  if (!scope) return
  const container = (ctx.container ?? { resolve: ctx.resolve }) as AwilixContainer
  await runBookingSweep({ container, em }, scope)
}
