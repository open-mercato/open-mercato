"use client"
import { NotificationBell } from '@open-mercato/ui/backend/notifications'
import { salesNotificationTypes } from '@open-mercato/core/modules/sales/notifications.client'
import { recordLocksNotificationTypes } from '@open-mercato/enterprise/modules/record_locks/notifications.client'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const notificationRenderers = Object.fromEntries(
  [...salesNotificationTypes, ...recordLocksNotificationTypes]
    .filter((type) => Boolean(type.Renderer))
    .map((type) => [type.type, type.Renderer!])
)

export function NotificationBellWrapper() {
  const t = useT()
  return <NotificationBell t={t} customRenderers={notificationRenderers} />
}
