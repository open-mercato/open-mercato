import type { NotificationAction } from '@open-mercato/shared/modules/notifications/types'
import { isSafeNotificationHref } from '@open-mercato/shared/modules/notifications/safeHref'

export { isSafeNotificationHref }

export function toSafeNotificationHref(href: string | null | undefined): string | null {
  if (href == null || !isSafeNotificationHref(href)) {
    return null
  }

  return href
}

export function resolveNotificationActionHref(
  href: string | undefined | null,
  sourceEntityId: string | undefined | null,
): string | undefined {
  return href?.replace('{sourceEntityId}', sourceEntityId ?? '') ?? undefined
}

export function assertSafeNotificationHref(href: string | undefined | null): string | undefined {
  if (href == null) {
    return undefined
  }

  if (!isSafeNotificationHref(href)) {
    throw new Error('Notification href must be a same-origin relative path starting with /')
  }

  return href
}

export function sanitizeNotificationActions(
  actions: NotificationAction[] | undefined
): NotificationAction[] | undefined {
  if (!actions) {
    return undefined
  }

  return actions.map((action) => (
    action.href ? { ...action, href: assertSafeNotificationHref(action.href) } : action
  ))
}
