import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { LEASE_SWEEP_QUEUE, runLeaseSweep } from '../lib/leaseSweep'

type LeaseSweepPayload = { scope?: { tenantId?: string | null; organizationId?: string | null } }

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
  const tenantId = job.payload?.scope?.tenantId
  const organizationId = job.payload?.scope?.organizationId
  if (typeof tenantId !== 'string' || !tenantId || typeof organizationId !== 'string' || !organizationId) return
  const container = (ctx.container ?? { resolve: ctx.resolve }) as AwilixContainer
  await runLeaseSweep({ container, em: ctx.resolve<EntityManager>('em') }, { tenantId, organizationId })
}
