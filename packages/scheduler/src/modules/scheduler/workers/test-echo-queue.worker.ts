import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('scheduler').child({ component: 'test-echo-queue' })

export const metadata: WorkerMeta = {
  queue: 'scheduler-test',
  id: 'scheduler:test-echo-queue',
  concurrency: 1,
  /**
   * Deliberate scheduler-safe target for QA fixtures and manual experiments,
   * mirroring the `scheduler.test.echo` command. The handler is side-effect
   * free: it only logs that a delivery arrived.
   */
  schedulerSafe: true,
}

type TestEchoPayload = {
  message?: unknown
}

export default async function handle(job: QueuedJob<TestEchoPayload>, _ctx: JobContext): Promise<void> {
  const message = typeof job.payload?.message === 'string' ? job.payload.message : ''
  logger.info('Test queue target received a scheduled delivery', { messageId: message.slice(0, 80) })
}
