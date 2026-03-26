import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { WebhookEntity } from '../data/entities'
import { resolveWebhookIntegrationSettings } from '../lib/integration-settings'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'webhooks.delivery.exhausted',
  persistent: true,
  id: 'webhooks:failed-delivery-notification',
}

type WebhookDeliveryExhaustedPayload = {
  deliveryId: string
  webhookId: string
  eventType: string
  errorMessage?: string | null
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: WebhookDeliveryExhaustedPayload, ctx: ResolverContext) {
  try {
    const organizationId = payload.organizationId ?? null
    const settings = await resolveWebhookIntegrationSettings(ctx, {
      tenantId: payload.tenantId,
      organizationId: organizationId ?? '',
    })
    if (!settings.notifyOnFailedDelivery) return

    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'webhooks.delivery.failed')
    if (!typeDef) return

    const em = ctx.resolve<EntityManager>('em').fork()
    const webhook = await findOneWithDecryption(
      em,
      WebhookEntity,
      {
        id: payload.webhookId,
        tenantId: payload.tenantId,
        organizationId: organizationId ?? undefined,
        deletedAt: null,
      },
      {},
      { tenantId: payload.tenantId, organizationId: organizationId ?? '' },
    )

    const webhookName = webhook?.name?.trim() || payload.webhookId
    const errorMessage = payload.errorMessage?.trim() || 'Delivery retries exhausted'

    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'webhooks.manage',
      titleVariables: {
        webhookName,
      },
      bodyVariables: {
        webhookName,
        eventType: payload.eventType,
        errorMessage,
      },
      sourceEntityType: 'webhooks:webhook',
      sourceEntityId: payload.webhookId,
      linkHref: `/backend/webhooks/${payload.webhookId}`,
      groupKey: `delivery-failed:${payload.deliveryId}`,
    })

    await notificationService.createForFeature(notificationInput, {
      tenantId: payload.tenantId,
      organizationId,
    })
  } catch (err) {
    console.error('[webhooks:failed-delivery-notification] Failed to create notification:', err)
  }
}
