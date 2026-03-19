import { createQueue } from '@open-mercato/queue'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { notificationTypes } from '../notifications'
import { CHECKOUT_EMAIL_QUEUE } from '../workers/send-email.worker'
import type { CheckoutEmailJob } from '../workers/send-email.worker'

export const metadata = {
  event: 'checkout.transaction.failed',
  persistent: true,
  id: 'checkout:transaction-failed-notify',
}

type FailedPayload = {
  transactionId: string
  linkId: string
  slug?: string | null
  status: string
  amount?: number | null
  currency?: string | null
  tenantId: string
  organizationId: string
}

export default async function handle(payload: FailedPayload) {
  if (!payload.transactionId || !payload.tenantId || !payload.organizationId) return

  try {
    const container = await createRequestContainer()
    const notificationService = resolveNotificationService(container)
    const typeDef = notificationTypes.find((n) => n.type === 'checkout.transaction.failed')

    if (typeDef) {
      const input = buildFeatureNotificationFromType(typeDef, {
        requiredFeature: 'checkout.view',
        bodyVariables: {
          amount: payload.amount != null ? String(payload.amount) : '',
          currency: payload.currency ?? '',
        },
        sourceEntityType: 'checkout:checkout_transaction',
        sourceEntityId: payload.transactionId,
        linkHref: `/backend/checkout/transactions/${payload.transactionId}`,
      })
      await notificationService.createForFeature(input, {
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
      })
    }
  } catch (err) {
    console.error('[checkout:transaction-failed-notify] notification failed:', err)
  }

  try {
    const strategy = process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'
    const emailQueue = createQueue<CheckoutEmailJob>(CHECKOUT_EMAIL_QUEUE, strategy)
    await emailQueue.enqueue({
      type: 'error',
      transactionId: payload.transactionId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
  } catch (err) {
    console.error('[checkout:transaction-failed-notify] email enqueue failed:', err)
  }
}
