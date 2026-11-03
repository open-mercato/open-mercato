import type { EntityManager } from '@mikro-orm/postgresql'
import { getNotificationType } from '@open-mercato/core/modules/notifications/lib/notification-type-registry'
import type { PushOptions } from '@open-mercato/core/modules/communication_channels/lib/push-envelope'
import { ADMIN_CUSTOM_MESSAGE_TYPE, ADMIN_CUSTOM_SILENT_TYPE } from '../notifications'
import { fanOutPushDeliveries } from './push-fanout'

type Resolve = <T = unknown>(name: string) => T

export interface SendCustomPushArgs {
  /** Scoped DI resolver (e.g. an API route's request container `resolve`). */
  resolve: Resolve
  tenantId: string
  userId: string
  organizationId?: string | null
  /** Restrict delivery to one of the user's devices (`UserDevice.id`). Omit to send to all. */
  deviceId?: string
  /** Literal, already-authored push title (free text — not an i18n key, so not translated). */
  title: string
  /** Optional literal push body. */
  body?: string | null
  /** Arbitrary app-readable key/values delivered in the push data payload. */
  data?: Record<string, string>
  /** Optional per-provider push customization (sound, badge, priority, …). */
  pushOptions?: PushOptions
  /**
   * When true, deliver as a **silent** data-only content-available wake-up (no visible banner)
   * instead of a visible alert. Defaults to false (visible).
   */
  silent?: boolean
  /**
   * Registered notification type to label the delivery with. Defaults to the admin custom-message
   * type (visible) or the admin custom-silent type when `silent` is set. Its `silent` flag MUST
   * match the requested mode.
   */
  type?: string
}

/**
 * Deliver an admin-composed, one-off push to all of a user's push-capable devices — **visible**
 * (literal title/body banner) or **silent** (`silent: true` — a data-only content-available wake-up
 * with no banner).
 *
 * A direct fan-out (no in-app `Notification` row, no email, no per-channel preference check). The
 * `type` MUST be registered and its `silent` flag MUST match the requested mode. Because the copy is
 * literal free text, it is delivered verbatim (no per-device locale translation). The actual provider
 * send happens in the `send-push` worker; the returned `enqueued` is the number of per-device jobs.
 *
 * Note: delivery here is forced by the direct fan-out itself — this path never consults the
 * preference service, so the type's `nonOptOut: true` is not load-bearing on this route (it matters
 * only if that type is ever routed through the normal preference-gated `notificationService.create()`
 * strategy).
 */
export async function sendCustomPush(args: SendCustomPushArgs): Promise<{ enqueued: number }> {
  const {
    resolve,
    tenantId,
    userId,
    organizationId = null,
    deviceId,
    title,
    body = null,
    data,
    pushOptions,
    silent = false,
    type = silent ? ADMIN_CUSTOM_SILENT_TYPE : ADMIN_CUSTOM_MESSAGE_TYPE,
  } = args

  const definition = getNotificationType(type)
  if (!definition) {
    throw new Error(`[internal] sendCustomPush: notification type "${type}" is not registered`)
  }
  if ((definition.silent === true) !== silent) {
    throw new Error(`[internal] sendCustomPush: type "${type}" silent=${definition.silent === true} does not match requested silent=${silent}`)
  }

  const em = resolve('em') as EntityManager

  return fanOutPushDeliveries({
    em,
    resolve,
    scope: { tenantId, organizationId },
    userId,
    userDeviceId: deviceId,
    notificationId: null,
    notificationTypeId: type,
    payload: {
      title,
      body,
      data: { ...(data ?? {}), type },
      options: pushOptions,
      silent,
    },
  })
}

export interface PushNotificationService {
  sendCustomPush(args: SendCustomPushArgs): Promise<{ enqueued: number }>
}

export const pushNotificationService: PushNotificationService = { sendCustomPush }
