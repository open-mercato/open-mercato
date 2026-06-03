import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { notificationTypes } from '../notifications'
import {
  buildNotificationFromType,
  buildFeatureNotificationFromType,
} from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'

/**
 * Subscriber: re-authentication notification.
 *
 * Listens to `communication_channels.channel.requires_reauth` (emitted by the
 * poll worker and outbound delivery when an
 * adapter loses authorization) and raises the in-app
 * `communication_channels.channel.requires_reauth` notification so the affected
 * user sees a bell entry + reconnect CTA and the reactive toast handler
 * (`notifications.handlers.ts`) fires. This is the producer half of the
 * notification contract declared in `notifications.ts` /
 * `notifications.client.ts` — without it the notification is never persisted.
 *
 * Recipient: per-user channels notify the channel owner (`channel.userId`) — the
 * only person who can complete their own OAuth/credential reconnect. Tenant-wide
 * (shared) channels have no owner, so operators holding
 * `communication_channels.manage` are notified instead.
 *
 * Idempotency: `groupKey = channelId` collapses repeated reauth events for the
 * same channel onto one notification (the notification service dedupes by
 * tenant/org/recipient/type/groupKey under an advisory lock), so a flapping
 * channel or a subscriber retry never spams the bell.
 */
export const metadata = {
  event: 'communication_channels.channel.requires_reauth',
  persistent: true,
  id: 'communication_channels:channel-requires-reauth-notification',
}

const NOTIFICATION_TYPE = 'communication_channels.channel.requires_reauth'
const MANAGE_FEATURE = 'communication_channels.manage'

type RequiresReauthPayload = {
  channelId?: string
  providerKey?: string
  channelType?: string
  reason?: string
  tenantId?: string
  organizationId?: string | null
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve: <T = unknown>(name: string) => T }
}

function resolveFromCtx<T = unknown>(ctx: SubscriberContext, name: string): T {
  if (typeof ctx?.resolve === 'function') return ctx.resolve<T>(name)
  if (ctx?.container && typeof ctx.container.resolve === 'function') {
    return ctx.container.resolve<T>(name)
  }
  throw new Error(
    `channel-requires-reauth-notification: subscriber context has no resolver (looking for '${name}')`,
  )
}

export default async function handler(
  payload: RequiresReauthPayload,
  ctx: SubscriberContext,
): Promise<void> {
  if (!payload?.channelId || !payload.tenantId) {
    return
  }

  const typeDef = notificationTypes.find((type) => type.type === NOTIFICATION_TYPE)
  if (!typeDef) return

  const scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
  }

  const em = resolveFromCtx<EntityManager>(ctx, 'em').fork()
  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: payload.channelId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!channel) return

  const notificationService = resolveNotificationService(ctx)
  const common = {
    sourceEntityType: 'communication_channel',
    sourceEntityId: payload.channelId,
    groupKey: payload.channelId,
  }

  if (channel.userId) {
    await notificationService.create(
      buildNotificationFromType(typeDef, { ...common, recipientUserId: channel.userId }),
      scope,
    )
    return
  }

  // Tenant-wide (shared) channel — no single owner. Notify operators who can
  // reconnect it on behalf of the tenant.
  await notificationService.createForFeature(
    buildFeatureNotificationFromType(typeDef, { ...common, requiredFeature: MANAGE_FEATURE }),
    scope,
  )
}
