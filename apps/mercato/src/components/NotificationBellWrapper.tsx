"use client"
import { NotificationBell } from '@open-mercato/ui/backend/notifications'
import { salesNotificationTypes } from '@open-mercato/core/modules/sales/notifications.client'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const notificationRenderers = Object.fromEntries(
  salesNotificationTypes
    .filter((type) => Boolean(type.Renderer))
    .map((type) => [type.type, type.Renderer!])
)

export function NotificationBellWrapper() {
  const t = useT()
  return <NotificationBell t={t} customRenderers={notificationRenderers} />
}
