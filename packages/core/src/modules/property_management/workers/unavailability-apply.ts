import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { UNAVAILABILITY_APPLY_QUEUE } from '../lib/queues'
import { runUnavailabilityApply, UNAVAILABILITY_APPLY_MAX_ATTEMPTS, type LegacyUnavailabilityApplyJob } from '../lib/unavailabilityApply'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
  container?: AwilixContainer
}

export const metadata: WorkerMeta = {
  queue: UNAVAILABILITY_APPLY_QUEUE,
  id: 'property_management:unavailability-apply',
  concurrency: 1,
}

export default async function handle(job: QueuedJob<LegacyUnavailabilityApplyJob>, ctx: HandlerContext): Promise<void> {
  const payload = job.payload
  if (typeof payload?.unavailabilityId !== 'string') return
  const container = (ctx.container ?? { resolve: ctx.resolve }) as AwilixContainer
  const attempt = { attemptNumber: ctx.attemptNumber, maxAttempts: UNAVAILABILITY_APPLY_MAX_ATTEMPTS }
  await runUnavailabilityApply({ container, em: ctx.resolve<EntityManager>('em'), attempt }, payload)
}
