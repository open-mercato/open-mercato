import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'

export type NotificationTranslate = (
  key: string,
  fallback?: string,
  variables?: Record<string, string>,
) => string

/**
 * Give reactive handlers display copy instead of dictionary keys.
 *
 * `buildBaseNotificationFields` persists `title` / `body` as the type's
 * `titleKey` / `bodyKey`; the bell panel translates them through
 * `NotificationItem`, but a handler that forwards `notification.title` to
 * `context.toast(...)` would show the raw key. Resolving here, once per
 * dispatch, keeps every handler's toast/popup localized without each one
 * having to remember the translator (#6099).
 *
 * Without a translator (dispatch outside an `I18nProvider`) the DTO is
 * returned untouched, so the previous behaviour is the fallback.
 */
export function localizeNotificationCopy(
  notification: NotificationDto,
  t: NotificationTranslate | undefined,
): NotificationDto {
  if (!t) return notification
  const title = notification.titleKey
    ? t(notification.titleKey, notification.title, notification.titleVariables ?? undefined)
    : notification.title
  const body = notification.bodyKey
    ? t(notification.bodyKey, notification.body ?? notification.bodyKey, notification.bodyVariables ?? undefined)
    : notification.body
  if (title === notification.title && body === notification.body) return notification
  return { ...notification, title, body }
}
