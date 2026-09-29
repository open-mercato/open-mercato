import type { EntityManager } from '@mikro-orm/postgresql'
import type { NotificationDeliveryStrategy } from '@open-mercato/core/modules/notifications/lib/deliveryStrategies'
import { getNotificationType } from '@open-mercato/core/modules/notifications/lib/notification-type-registry'
import type { PushOptions } from '@open-mercato/core/modules/communication_channels/lib/push-envelope'
import type { NotificationCopySource } from '@open-mercato/core/modules/notifications/lib/notificationCopy'
import { fanOutPushDeliveries, PUSH_CHANNEL, type PushFanoutPayload } from './push-fanout'

export { PUSH_CHANNEL } from './push-fanout'

/**
 * `push` notification delivery strategy.
 *
 * Registered into the notifications strategy seam (see notifications.delivery-strategies.ts).
 * Runs inside the persistent `notifications:deliver` subscriber for every created notification.
 * It only enqueues fast work — the actual provider send (with retry/backoff) happens in the
 * `send-push` worker, so a slow/unavailable provider never blocks notification creation.
 *
 * Whether a push is silent (content-available wake-up) is a property of the registered
 * notification TYPE (`NotificationTypeDefinition.silent`), never a per-call flag. `silent`
 * controls only HOW the device is notified (background wake-up vs visible alert); it does not
 * imply the push is non-opt-out. Silent types still respect the recipient's per-channel
 * preference unless the type is `nonOptOut` — to force a silent push, mark the type
 * `nonOptOut: true`. A silent push is therefore just a notification created through the normal
 * `notificationService.create()` flow whose type is `silent: true`; there is no separate helper.
 *
 * The shared device/channel fan-out lives in {@link fanOutPushDeliveries}.
 */
export const mobilePushDeliveryStrategy: NotificationDeliveryStrategy = {
  id: PUSH_CHANNEL,
  label: 'Mobile push',
  // Attempt push whenever a tenant has a push channel configured; the fan-out short-circuits
  // (no rows, no enqueue) when push is not set up for the tenant/recipient.
  defaultEnabled: true,
  async deliver(ctx) {
    const { notification } = ctx
    const tenantId = notification.tenantId
    const userId = notification.recipientUserId
    const organizationId = notification.organizationId ?? null

    // Skip unknown types (the catalogue is the source of truth for what can notify a user).
    const type = getNotificationType(notification.type)
    if (!type) return

    const em = ctx.resolve('em') as EntityManager
    const silent = type.silent === true

    // Per-channel opt-out / `nonOptOut` is enforced once, upstream, at create time: the dispatcher
    // only invokes this strategy when `push ∈ notification.channels` (the resolved target snapshot).
    // `silent` still controls delivery STYLE only (content-available wake-up vs visible alert).

    // App-readable data payload: caller-supplied custom fields plus the system identifiers.
    const data: Record<string, string> = { ...(notification.data ?? {}) }
    data.notificationId = notification.id
    data.type = notification.type
    if (notification.linkHref) data.linkHref = notification.linkHref

    const payload: PushFanoutPayload = {
      data,
      options: (notification.pushOptions ?? undefined) as PushOptions | undefined,
      silent,
    }

    // For visible notifications, hand the raw copy down so the fan-out can translate title/body per
    // device locale. `ctx.title`/`ctx.body` are already resolved in the default locale and serve as
    // the fallback. Silent pushes carry no user-facing copy, so they skip translation entirely.
    const copy: NotificationCopySource | undefined = silent
      ? undefined
      : {
          titleKey: notification.titleKey ?? null,
          bodyKey: notification.bodyKey ?? null,
          titleVariables: notification.titleVariables ?? null,
          bodyVariables: notification.bodyVariables ?? null,
          title: ctx.title,
          body: ctx.body,
        }

    await fanOutPushDeliveries({
      em,
      resolve: ctx.resolve,
      scope: { tenantId, organizationId },
      userId,
      notificationId: notification.id,
      notificationTypeId: notification.type,
      payload,
      copy,
    })
  },
}

export default mobilePushDeliveryStrategy
