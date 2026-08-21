import type { EntityManager } from '@mikro-orm/postgresql'
import type { SubscriberContext } from '@open-mercato/events/types'
import { WebhookDeliveryEntity, WebhookEntity } from '../data/entities'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { matchAnyWebhookEventPattern } from '@open-mercato/shared/lib/events/patterns'
import { getDeclaredEvents } from '@open-mercato/shared/modules/events'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createWebhookDelivery } from '../lib/delivery'
import { enqueueWebhookDelivery } from '../lib/queue'
import { isWebhookIntegrationEnabled } from '../lib/integration-state'

const logger = createLogger('webhooks')

export const metadata = {
  event: '*',
  persistent: true,
  id: 'webhooks:outbound-dispatch',
}

function shouldSkipOutboundDispatch(eventId: string): boolean {
  if (eventId.startsWith('webhooks.') || eventId.startsWith('application.')) return true

  const declaredEvent = getDeclaredEvents().find((event) => event.id === eventId)
  return declaredEvent?.excludeFromTriggers === true
}

function forkOutboundEntityManager(em: EntityManager): EntityManager {
  const fork = (em as unknown as { fork?: (options?: Record<string, unknown>) => EntityManager }).fork
  if (typeof fork !== 'function') return em
  return fork.call(em, { clear: true, useContext: false })
}

function integrationScopeKey(tenantId: string, organizationId: string): string {
  return `${tenantId}:${organizationId}`
}

export default async function handler(
  payload: Record<string, unknown>,
  ctx: (SubscriberContext & { eventId?: string }) | { container?: { resolve: <T = unknown>(name: string) => T }; eventId?: string; eventName?: string; resolve?: <T = unknown>(name: string) => T },
) {
  const eventId = ctx.eventId ?? ctx.eventName ?? (payload.eventId as string) ?? (payload.type as string)
  if (!eventId) return
  if (shouldSkipOutboundDispatch(eventId)) return

  const tenantId = payload.tenantId as string | undefined
  const organizationId = payload.organizationId as string | undefined
  if (!tenantId) return

  if (eventId.startsWith('webhooks.')) return
  if (eventId.startsWith('query_index.')) return


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
    { tenantId, organizationId: organizationId ?? null },
  )

  if (!webhooks.length) return

  const matchingWebhooks = webhooks.filter((webhook) =>
    matchAnyWebhookEventPattern(eventId, webhook.subscribedEvents),
  )

  if (!matchingWebhooks.length) return

  const integrationEnabledByScope = new Map<string, Promise<boolean>>()

  const resolveIntegrationEnabled = (webhook: WebhookEntity): Promise<boolean> => {
    const key = integrationScopeKey(webhook.tenantId, webhook.organizationId)
    let pending = integrationEnabledByScope.get(key)
    if (!pending) {
      pending = isWebhookIntegrationEnabled(em, {
        tenantId: webhook.tenantId,
        organizationId: webhook.organizationId,
      })
      integrationEnabledByScope.set(key, pending)
    }
    return pending
  }

  await Promise.all(
    matchingWebhooks.map(async (webhook) => {
      if (!(await resolveIntegrationEnabled(webhook))) return

      const webhookEm = forkOutboundEntityManager(em)
      let createdDeliveryId: string | null = null
      try {
        const delivery = await createWebhookDelivery({
          em: webhookEm,
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
          const failedDelivery = await findOneWithDecryption(
            webhookEm,
            WebhookDeliveryEntity,
            { id: createdDeliveryId, tenantId: webhook.tenantId, organizationId: webhook.organizationId },
            undefined,
            { tenantId: webhook.tenantId, organizationId: webhook.organizationId },
          )
          if (failedDelivery) {
            failedDelivery.status = 'failed'
            failedDelivery.errorMessage = error instanceof Error ? `Queue enqueue failed: ${error.message}` : 'Queue enqueue failed'
            failedDelivery.nextRetryAt = null
            await webhookEm.flush()
          }
        }
        logger.error('Failed to enqueue outbound delivery', {
          webhookId: webhook.id,
          eventId,
          tenantId,
          organizationId: organizationId ?? webhook.organizationId,
          err: error,
        })
      }
    }),
  )
}
