import type { EntityManager } from '@mikro-orm/postgresql'
import { WebhookDeliveryEntity, WebhookEntity } from '../data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createWebhookDelivery, enqueueWebhookDelivery } from '../lib/delivery'

export const metadata = {
  event: '*',
  persistent: true,
  id: 'webhooks:outbound-dispatch',
}

export default async function handler(
  payload: Record<string, unknown>,
  ctx: { container: { resolve: <T = unknown>(name: string) => T }; eventId?: string },
) {
  const eventId = ctx.eventId ?? (payload.eventId as string) ?? (payload.type as string)
  if (!eventId) return

  const tenantId = payload.tenantId as string | undefined
  const organizationId = payload.organizationId as string | undefined
  if (!tenantId) return

  if (eventId.startsWith('webhooks.')) return

  const em = (ctx.container.resolve('em') as EntityManager).fork()

  const webhooks = await findWithDecryption(
    em,
    WebhookEntity,
    {
      isActive: true,
      deletedAt: null,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
    },
    {},
    { tenantId, organizationId: organizationId ?? '' },
  )

  if (!webhooks.length) return

  const matchingWebhooks = webhooks.filter((webhook) =>
    webhook.subscribedEvents.some((pattern) => eventMatchesPattern(eventId, pattern)),
  )

  if (!matchingWebhooks.length) return

  for (const webhook of matchingWebhooks) {
    let createdDeliveryId: string | null = null
    try {
      const delivery = await createWebhookDelivery({
        em,
        webhook,
        eventId,
        payload,
      })
      createdDeliveryId = delivery.id

      await enqueueWebhookDelivery({
        deliveryId: delivery.id,
        tenantId: delivery.tenantId,
        organizationId: delivery.organizationId,
      })
    } catch (error) {
      if (createdDeliveryId) {
        const failedDelivery = await em.findOne(WebhookDeliveryEntity, { id: createdDeliveryId })
        if (failedDelivery) {
          failedDelivery.status = 'failed'
          failedDelivery.errorMessage = error instanceof Error ? `Queue enqueue failed: ${error.message}` : 'Queue enqueue failed'
          failedDelivery.nextRetryAt = null
          await em.flush()
        }
      }
      console.error('[webhooks] Failed to enqueue outbound delivery', {
        webhookId: webhook.id,
        eventId,
        tenantId,
        organizationId: organizationId ?? webhook.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

function eventMatchesPattern(eventId: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern === eventId) return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return eventId.startsWith(prefix + '.')
  }
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1)
    return eventId.startsWith(prefix)
  }
  return false
}
