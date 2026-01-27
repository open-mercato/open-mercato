'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { NotificationPanel } from '@open-mercato/ui/backend/notifications'
import { useNotificationsPoll } from '@open-mercato/ui/backend/notifications'

export function NotificationInboxPageClient() {
  const t = useT()
  const router = useRouter()
  const {
    notifications,
    unreadCount,
    markAsRead,
    executeAction,
    dismiss,
    dismissUndo,
    undoDismiss,
    markAllRead,
  } = useNotificationsPoll()

  return (
    <NotificationPanel
      open
      onOpenChange={(open) => {
        if (!open) router.push('/backend')
      }}
      notifications={notifications}
      unreadCount={unreadCount}
      onMarkAsRead={markAsRead}
      onExecuteAction={executeAction}
      onDismiss={dismiss}
      dismissUndo={dismissUndo}
      onUndoDismiss={undoDismiss}
      onMarkAllRead={markAllRead}
      t={t}
    />
  )
}

export default NotificationInboxPageClient
