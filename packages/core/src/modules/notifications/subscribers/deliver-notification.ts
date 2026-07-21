import type { EntityManager } from '@mikro-orm/postgresql'
import { Notification } from '../data/entities'
import { NOTIFICATION_EVENTS } from '../lib/events'
import { DEFAULT_NOTIFICATION_DELIVERY_CONFIG, resolveNotificationDeliveryConfig, resolveNotificationPanelUrl } from '../lib/deliveryConfig'
import { getNotificationDeliveryStrategies, type NotificationDeliveryContext } from '../lib/deliveryStrategies'
import { resolveEffectiveChannels } from '../lib/shouldDeliver'
import { getNotificationType } from '../lib/notification-type-registry'
import { getNotificationTypeOverrides } from '../lib/typeOverrides'
import { resolveNotificationPreferenceService } from '../lib/notificationPreferenceService'
import { resolveNotificationCopy } from '../lib/notificationCopy'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '../../auth/data/entities'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('notifications').child({ component: 'deliver' })

export const metadata = {
  event: NOTIFICATION_EVENTS.CREATED,
  persistent: true,
  id: 'notifications:deliver',
}

function debug(message: string, ...details: unknown[]): void {
  logger.debug(message, details.length ? { details } : undefined)
}

type NotificationCreatedPayload = {
  notificationId: string
  recipientUserId: string
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

const buildPanelLink = (panelUrl: string, notificationId: string) => {
  if (panelUrl.startsWith('http://') || panelUrl.startsWith('https://')) {
    const url = new URL(panelUrl)
    url.searchParams.set('notificationId', notificationId)
    return url.toString()
  }
  const separator = panelUrl.includes('?') ? '&' : '?'
  return `${panelUrl}${separator}notificationId=${encodeURIComponent(notificationId)}`
}

const resolveRecipient = async (
  em: EntityManager,
  notification: Notification,
  encryptionService?: TenantDataEncryptionService | null,
) => {
  const where: Partial<User> & { deletedAt?: null } = {
    id: notification.recipientUserId,
    tenantId: notification.tenantId,
    deletedAt: null,
  }
  if (notification.organizationId) {
    where.organizationId = notification.organizationId
  }
  const record = await findOneWithDecryption(
    em,
    User,
    where,
    undefined,
    {
      tenantId: notification.tenantId,
      organizationId: notification.organizationId ?? null,
      encryptionService: encryptionService ?? null,
    },
  )
  if (!record) return null
  return {
    email: typeof record.email === 'string' ? record.email : null,
    name: typeof record.name === 'string' ? record.name : null,
  }
}

/**
 * Dispatches a created notification across every registered delivery channel. This is a pure
 * "resolve copy → loop strategies" loop with NO channel-specific branches: in-app, email, and push
 * are all first-class strategies on the seam. Per-channel opt-out / `nonOptOut` / `silent` /
 * eligibility / per-send targeting were already resolved once at create time into
 * `notification.channels` (see `shouldDeliver`); here we only replay that target set and apply each
 * strategy's technical short-circuits (`supports`, `isConfigured`). `notification.channels === null`
 * means "all channels" (legacy rows + pre-Phase-7 behavior).
 */
export default async function handle(payload: NotificationCreatedPayload, ctx: ResolverContext) {
  debug('deliver notification event', payload)
  const deliveryConfig = await resolveNotificationDeliveryConfig(ctx, { defaultValue: DEFAULT_NOTIFICATION_DELIVERY_CONFIG })

  const em = ctx.resolve('em') as EntityManager
  const notification = await findOneWithDecryption(
    em,
    Notification,
    {
      id: payload.notificationId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    },
    undefined,
    {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      encryptionService: null,
    },
  )
  if (!notification) {
    debug('notification not found', payload.notificationId)
    return
  }

  let encryptionService: TenantDataEncryptionService | null = null
  try {
    encryptionService = ctx.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  } catch {
    encryptionService = null
  }

  try {
    const recipient = (await resolveRecipient(em, notification, encryptionService)) ?? { email: null, name: null }
    if (!recipient?.email) {
      debug('recipient has no email', notification.recipientUserId)
    }
    const { title, body, t } = await resolveNotificationCopy(notification)
    const panelUrl = resolveNotificationPanelUrl(deliveryConfig)
    if (!panelUrl) {
      debug('missing panelUrl; check appUrl/panelPath settings')
    }

    const panelLink = panelUrl ? buildPanelLink(panelUrl, notification.id) : null
    const baseOrigin = panelUrl ? new URL(panelUrl).origin : null
    const actionLinks = (notification.actionData?.actions ?? [])
      .map((action) => {
        let href = action.href
        if (href && notification.sourceEntityId) {
          href = href.replace('{sourceEntityId}', notification.sourceEntityId)
        }
        const fullHref = (href && baseOrigin) ? `${baseOrigin}${href}` : panelLink
        if (!fullHref) return null
        return {
          id: action.id,
          label: action.labelKey ? t(action.labelKey, action.label) : action.label,
          href: fullHref,
        }
      })
      .filter((action): action is NonNullable<typeof action> => action !== null)

    const strategyConfigs = deliveryConfig.strategies.custom ?? {}
    const strategies = getNotificationDeliveryStrategies()
    // Authoritative per-send target resolved at create time. A null snapshot (legacy pre-Phase-7 row,
    // or a create that ran before the delivery strategies were registered) would otherwise deliver
    // every channel with no gate — so recompute the effective set from current preferences here,
    // keeping the single `shouldDeliver` gate instead of re-checking opt-out inside each strategy.
    const persistedChannels = notification.channels
    const registeredStrategyIds = strategies.map((strategy) => strategy.id)
    let targetChannels: string[] | null = persistedChannels ?? null
    // Only recompute for a null-snapshot row when strategies are actually registered — mirror the
    // create path (`resolveChannelsFor`: `registeredChannels.length === 0 => null`). With zero
    // strategies, `resolveEffectiveChannels` returns `[]` (never null); persisting that would HIDE
    // the row (the visibility layer treats `[]` as "no channels"), so leave `channels` null and keep
    // legacy all-channels back-compat instead.
    if (persistedChannels == null && registeredStrategyIds.length > 0) {
      try {
        const typeOverrides = (
          await getNotificationTypeOverrides(em as EntityManager, notification.tenantId, [notification.type])
        ).get(notification.type)
        targetChannels = await resolveEffectiveChannels({
          typeId: notification.type,
          type: getNotificationType(notification.type),
          scope: { tenantId: notification.tenantId, userId: notification.recipientUserId },
          targetChannels: null,
          registeredChannels: registeredStrategyIds,
          preferences: resolveNotificationPreferenceService({ resolve: ctx.resolve }),
          channelsOverride: typeOverrides?.channels ?? null,
          nonOptOutOverride: typeOverrides?.nonOptOut ?? null,
        })
      } catch (err) {
        // A transient overrides/preference-service failure must not abort delivery on EVERY channel
        // (everything else here fails per-component). Fall back to null (deliver all, legacy) and
        // skip the persist below so visibility stays consistent with what was delivered.
        debug('failed to recompute channels; delivering all channels (legacy fallback)', err)
        targetChannels = null
      }
    }
    // Persist the recomputed set back onto a null-channels row so the in-app
    // VISIBILITY path (bell/inbox/unread — see notificationVisibility.ts) reads
    // the same authoritative target the DELIVERY gate just applied. Without this
    // the row stays `null` ⇒ "visible everywhere", so a notification suppressed
    // from in_app by the user's opt-out would still surface in the bell while
    // delivery correctly skipped it. `targetChannels` is null (skip persist) only
    // when no strategies are registered or the recompute fell back — both keep the
    // row null for legacy all-channels back-compat. `channels` is a plaintext JSONB
    // column, so a forked nativeUpdate avoids the shared UoW.
    if (persistedChannels == null && targetChannels != null) {
      try {
        await (em as EntityManager)
          .fork()
          .nativeUpdate(
            Notification,
            { id: notification.id, tenantId: notification.tenantId },
            { channels: targetChannels },
          )
      } catch (err) {
        debug('failed to persist recomputed channels', err)
      }
    }
    for (const strategy of strategies) {
      if (targetChannels && !targetChannels.includes(strategy.id)) {
        debug('channel not targeted', strategy.id)
        continue
      }
      const strategyConfig = strategyConfigs[strategy.id]
      const enabled = strategyConfig?.enabled ?? strategy.defaultEnabled ?? false
      if (!enabled) {
        debug('delivery disabled', strategy.id)
        continue
      }
      if (strategy.supports && !strategy.supports(notification)) {
        debug('strategy does not support notification', strategy.id)
        continue
      }
      const context: NotificationDeliveryContext = {
        notification,
        recipient,
        title,
        body,
        panelUrl,
        panelLink,
        actionLinks,
        deliveryConfig,
        config: strategyConfig ?? {},
        resolve: ctx.resolve,
        t,
      }
      try {
        if (strategy.isConfigured && !(await strategy.isConfigured(context))) {
          debug('strategy not configured', strategy.id)
          continue
        }
        await strategy.deliver(context)
      } catch (error) {
        logger.error('Delivery strategy failed', { strategyId: strategy.id, err: error })
      }
    }
  } catch (err) {
    logger.error('Failed to deliver notification', { notificationId: payload.notificationId, recipientUserId: notification.recipientUserId, err })
    throw err
  }

  return
}
