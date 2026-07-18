import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { runMrpJob } from '../lib/mrp/runJob.js'
import { MRP_RUN_QUEUE } from '../lib/mrp/queue.js'

/**
 * Task 5.2 — per-tenant MRP run worker (spec decision c: "one queue job per
 * tenant/org"). The cron fan-out (`commands/mrp.ts` ->
 * `production.mrp.cronFanOut`) and the on-demand `production.mrp.createRun`
 * command both enqueue exactly one job per `MrpRun` row onto this queue —
 * never one job iterating multiple tenants.
 */

export { MRP_RUN_QUEUE }

export const metadata: WorkerMeta = {
  queue: MRP_RUN_QUEUE,
  id: 'production:mrp-run',
  concurrency: 1,
}

export type MrpRunJobPayload = {
  mrpRunId: string
  tenantId: string
  organizationId: string
  userId?: string | null
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: QueuedJob<MrpRunJobPayload>,
  _ctx: HandlerContext,
): Promise<void> {
  const container = await createRequestContainer()
  await runMrpJob({
    container,
    mrpRunId: job.payload.mrpRunId,
    tenantId: job.payload.tenantId,
    organizationId: job.payload.organizationId,
    userId: job.payload.userId ?? null,
  })
}
