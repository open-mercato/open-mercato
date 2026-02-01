import type { NotificationAction } from '@open-mercato/shared/modules/notifications/types'

export function isSafeNotificationHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//')
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
