import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { runTillioPullJob, type TillioPullJobPayload } from '../lib/pull-job'
import { TILLIO_PULL_QUEUE } from '../lib/queue'

export const metadata: WorkerMeta = {
  queue: TILLIO_PULL_QUEUE,
  id: 'tillio:pull-calls',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<TillioPullJobPayload>,
  _ctx: JobContext,
): Promise<void> {
  const container = await createRequestContainer()
  await runTillioPullJob({ container, payload: job.payload })
}
