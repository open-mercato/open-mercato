import { dispatchCheckoutEmailJob } from '../lib/emailQueue'

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
    await dispatchCheckoutEmailJob({
      type: 'start',
      transactionId: payload.transactionId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
  } catch (err) {
    console.error('[checkout:session-started-email] email enqueue failed:', err)
  }
}
