import type { EntityManager } from '@mikro-orm/postgresql'
import type { SubscriberContext } from '@open-mercato/events/types'
import { WebhookDeliveryEntity, WebhookEntity } from '../data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { matchAnyWebhookEventPattern } from '@open-mercato/shared/lib/events/patterns'
import { createWebhookDelivery } from '../lib/delivery'
import { enqueueWebhookDelivery } from '../lib/queue'
import { isWebhookIntegrationEnabled } from '../lib/integration-state'

export const metadata = {
  event: '*',
  persistent: true,
  id: 'webhooks:outbound-dispatch',
}

export default async function handler(
  payload: Record<string, unknown>,
  ctx: (SubscriberContext & { eventId?: string }) | { container?: { resolve: <T = unknown>(name: string) => T }; eventId?: string; eventName?: string; resolve?: <T = unknown>(name: string) => T },
) {
  const eventId = ctx.eventId ?? ctx.eventName ?? (payload.eventId as string) ?? (payload.type as string)
  if (!eventId) return

  const tenantId = payload.tenantId as string | undefined
  const organizationId = payload.organizationId as string | undefined
  if (!tenantId) return

  if (eventId.startsWith('webhooks.')) return

  const resolve = ('resolve' in ctx && typeof ctx.resolve === 'function')
    ? ctx.resolve
    : ('container' in ctx && ctx.container && typeof ctx.container.resolve === 'function')
      ? ctx.container.resolve.bind(ctx.container)
      : null

  if (!resolve) return

  const em = (resolve('em') as EntityManager).fork()

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
    matchAnyWebhookEventPattern(eventId, webhook.subscribedEvents),
  )

  if (!matchingWebhooks.length) return

  for (const webhook of matchingWebhooks) {
    const integrationEnabled = await isWebhookIntegrationEnabled(em, {
      tenantId: webhook.tenantId,
      organizationId: webhook.organizationId,
    })

    if (!integrationEnabled) continue

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
