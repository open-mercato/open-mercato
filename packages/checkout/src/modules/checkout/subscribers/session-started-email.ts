import { createQueue } from '@open-mercato/queue'
import { CHECKOUT_EMAIL_QUEUE } from '../workers/send-email.worker'
import type { CheckoutEmailJob } from '../workers/send-email.worker'

export const metadata = {
  event: 'checkout.transaction.sessionStarted',
  persistent: true,
  id: 'checkout:session-started-email',
}

type SessionStartedPayload = {
  transactionId: string
  tenantId: string
  organizationId: string
}

export default async function handle(payload: SessionStartedPayload) {
  if (!payload.transactionId || !payload.tenantId || !payload.organizationId) return

  try {
    const strategy = process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'
    const emailQueue = createQueue<CheckoutEmailJob>(CHECKOUT_EMAIL_QUEUE, strategy)
    await emailQueue.enqueue({
      type: 'start',
      transactionId: payload.transactionId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
  } catch (err) {
    console.error('[checkout:session-started-email] email enqueue failed:', err)
  }
}
