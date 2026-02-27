"use client"
import { NotificationBell } from '@open-mercato/ui/backend/notifications'
import { getNotificationRenderers } from '@/.mercato/generated/notifications.client.generated'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const notificationRenderers = getNotificationRenderers()

export function NotificationBellWrapper() {
  const t = useT()
  return <NotificationBell t={t} customRenderers={notificationRenderers} />
}
