import crypto from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Webhook } from '../data/entities'
import type { WebhookTriggerPayload, WebhookDeliveryPayload, WebhookQueueJob } from '../data/types'
import { getWebhookQueue } from '../services/webhookQueue'

export const metadata = {
  event: 'webhooks.trigger',
  persistent: false,
}

export function generateDeliveryId(): string {
  const bytes = crypto.randomBytes(16)
  return `msg_${bytes.toString('base64url')}`
}

export default async function onWebhookTrigger(
  payload: WebhookTriggerPayload,
  ctx: { resolve: <T = unknown>(name: string) => T }
) {
  const { event, tenantId, data } = payload
  if (!tenantId) return

  const em = (ctx.resolve('em') as EntityManager).fork()
  const queue = getWebhookQueue()

  // Find all active webhooks for this tenant subscribed to this event
  const webhooks = await em.find(Webhook, {
    tenantId,
    active: true,
    events: { $contains: [event] },
  })

  if (!webhooks.length) return

  const timestamp = Math.floor(Date.now() / 1000)

  // Push job to queue for each matching webhook
  for (const webhook of webhooks) {
    const deliveryId = generateDeliveryId()

    const deliveryPayload: WebhookDeliveryPayload = {
      type: event,
      timestamp: new Date().toISOString(),
      id: deliveryId,
      tenantId,
      data: { object: data },
    }

    const job: WebhookQueueJob = {
      webhookId: webhook.id,
      deliveryId,
      event,
      tenantId,
      timestamp,
      payload: deliveryPayload,
      webhook: {
        deliveryType: webhook.deliveryType,
        config: webhook.config,
        secret: webhook.secret,
        retryConfig: webhook.retryConfig,
        timeout: webhook.timeout,
      },
    }

    // Add job to BullMQ queue
    await queue.add(`webhook:${event}`, job, {
      jobId: deliveryId,
    })

    // Update webhook lastTriggeredAt
    webhook.lastTriggeredAt = new Date()
  }

  await em.flush()
}
