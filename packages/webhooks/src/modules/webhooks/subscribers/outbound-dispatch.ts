import type { EntityManager } from '@mikro-orm/postgresql'
import { WebhookEntity } from '../data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

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

  const queue = ctx.container.resolve<{ enqueueJob: (data: unknown) => Promise<unknown> }>('queueService')

  for (const webhook of matchingWebhooks) {
    try {
      await queue.enqueueJob({
        queue: 'webhook-deliveries',
        data: {
          webhookId: webhook.id,
          eventId,
          payload,
          tenantId,
          organizationId: organizationId ?? webhook.organizationId,
        },
      })
    } catch {
      // Don't fail the event pipeline if queue is unavailable
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
