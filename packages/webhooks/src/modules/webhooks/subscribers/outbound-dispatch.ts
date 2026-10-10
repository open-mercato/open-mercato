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
import {
  getCachedActiveWebhooks,
  getWebhookSubscriptionCacheTtlMs,
  invalidateWebhookSubscriptionCacheFor,
  resolveWebhookSubscriptionCache,
  setCachedActiveWebhooks,
  type CachedActiveWebhook,
} from '../lib/subscription-cache'

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

/**
 * Reads a trusted scope field (`tenantId`/`organizationId`) off the subscriber context.
 * Only the `SubscriberContext` arm of `handler`'s `ctx` union carries these fields — the
 * minimal container-only arm does not — so this narrows with an `in` check rather than
 * trusting a cast, and never looks at `payload` (#2440).
 */
function resolveTrustedScopeField(
  ctx: { tenantId?: string | null; organizationId?: string | null } | Record<string, unknown>,
  field: 'tenantId' | 'organizationId',
): string | null {
  if (!(field in ctx)) return null
  const value = (ctx as Record<string, unknown>)[field]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export default async function handler(
  payload: Record<string, unknown>,
  ctx: (SubscriberContext & { eventId?: string }) | { container?: { resolve: <T = unknown>(name: string) => T }; eventId?: string; eventName?: string; resolve?: <T = unknown>(name: string) => T },
) {
  const eventId = ctx.eventId ?? ctx.eventName ?? (payload.eventId as string) ?? (payload.type as string)
  if (!eventId) return

  const resolve = ('resolve' in ctx && typeof ctx.resolve === 'function')
    ? ctx.resolve
    : ('container' in ctx && ctx.container && typeof ctx.container.resolve === 'function')
      ? ctx.container.resolve.bind(ctx.container)
      : null

  if (eventId.startsWith('webhooks.webhook.')) {
    const changedTenantId = payload.tenantId as string | undefined
    if (resolve && changedTenantId) {
      await invalidateWebhookSubscriptionCacheFor(resolve, changedTenantId)
    }
    return
  }

  if (shouldSkipOutboundDispatch(eventId)) return

  // Trusted scope only (#2440). ctx.tenantId/organizationId come from the emitter's own
  // `options` (packages/events/AGENTS.md: "Never rely on payload-provided tenant or
  // organization scope when trusted scope is available") — the dominant emission path,
  // DataEngine.emitOrmEntityEvent, always sets them from the entity's own persisted
  // identifiers, not from caller-suppliable payload fields. A command that emitted an
  // event carrying a wrong or crafted payload.tenantId must not redirect webhook delivery
  // to that tenant's endpoints: this decides WHICH TENANT'S webhooks fire, so it never
  // falls back to the payload. An event with no trusted scope is skipped outright.
  const trustedTenantId = resolveTrustedScopeField(ctx, 'tenantId')
  if (!trustedTenantId) {
    if (payload.tenantId) {
      logger.warn('Skipping outbound webhook dispatch: event carries a payload tenantId but no trusted scope', {
        eventId,
      })
    }
    return
  }
  const tenantId = trustedTenantId
  const organizationId = resolveTrustedScopeField(ctx, 'organizationId') ?? undefined

  if (eventId.startsWith('webhooks.')) return
  if (eventId.startsWith('query_index.')) return

  if (!resolve) return

  const cacheTtlMs = getWebhookSubscriptionCacheTtlMs()
  const subscriptionCache = cacheTtlMs > 0 ? resolveWebhookSubscriptionCache(resolve) : null
  const cachedActiveWebhooks = subscriptionCache
    ? await getCachedActiveWebhooks(subscriptionCache, tenantId, organizationId ?? null)
    : null

  let matchingIds: string[] | null = null

  if (cachedActiveWebhooks) {
    matchingIds = cachedActiveWebhooks
      .filter((entry) => matchAnyWebhookEventPattern(eventId, entry.subscribedEvents))
      .map((entry) => entry.id)

    if (!matchingIds.length) return
  }

  const em = (resolve('em') as EntityManager).fork()

  const webhooks = await findWithDecryption(
    em,
    WebhookEntity,
    {
      isActive: true,
      deletedAt: null,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      ...(matchingIds ? { id: { $in: matchingIds } } : {}),
    },
    {},
    { tenantId, organizationId: organizationId ?? null },
  )

  if (!matchingIds && subscriptionCache) {
    const cacheable: CachedActiveWebhook[] = webhooks.map((webhook) => ({
      id: webhook.id,
      tenantId: webhook.tenantId,
      organizationId: webhook.organizationId ?? null,
      subscribedEvents: webhook.subscribedEvents,
    }))
    await setCachedActiveWebhooks(subscriptionCache, tenantId, organizationId ?? null, cacheable, cacheTtlMs)
  }

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
