import { createQueue } from '@open-mercato/queue'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import handleCheckoutEmailJob, {
  CHECKOUT_EMAIL_QUEUE,
  type CheckoutEmailJob,
} from '../workers/send-email.worker'

type InlineEmailJobContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export async function dispatchCheckoutEmailJob(payload: CheckoutEmailJob): Promise<void> {
  const strategy = process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'

  if (strategy === 'async') {
    const emailQueue = createQueue<CheckoutEmailJob>(CHECKOUT_EMAIL_QUEUE, 'async')
    await emailQueue.enqueue(payload)
    return
  }

  const container = await createRequestContainer()
  const job: QueuedJob<CheckoutEmailJob> = {
    id: `inline-${Date.now()}`,
    payload,
    createdAt: new Date().toISOString(),
  }
  const ctx: InlineEmailJobContext = {
    jobId: job.id,
    attemptNumber: 1,
    queueName: CHECKOUT_EMAIL_QUEUE,
    resolve: <T = unknown>(name: string) => container.resolve(name) as T,
  }

  await handleCheckoutEmailJob(job, ctx)
}
