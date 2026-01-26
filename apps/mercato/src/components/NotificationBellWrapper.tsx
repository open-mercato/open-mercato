"use client"
import { NotificationBell } from '@open-mercato/ui/backend/notifications'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function NotificationBellWrapper() {
  const t = useT()
  return <NotificationBell t={t} />
}
