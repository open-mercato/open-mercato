"use client"
import * as React from 'react'
import { Bell } from 'lucide-react'
import { IconButton } from '../../primitives/icon-button'
import { cn } from '@open-mercato/shared/lib/utils'
import { useNotificationsPoll } from './useNotificationsPoll'
import { NotificationPanel } from './NotificationPanel'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRenderers } from './NotificationPanel'

export type NotificationBellProps = {
  className?: string
  t: TranslateFn
  customRenderers?: NotificationRenderers
}

export function NotificationBell({ className, t, customRenderers }: NotificationBellProps) {
  const [panelOpen, setPanelOpen] = React.useState(false)
  const {
    unreadCount,
    hasNew,
    notifications,
    markAsRead,
    executeAction,
    dismiss,
    dismissUndo,
    undoDismiss,
    markAllRead,
  } = useNotificationsPoll()
  const prevCountRef = React.useRef(unreadCount)
  const [pulse, setPulse] = React.useState(false)

  React.useEffect(() => {
    if (hasNew && unreadCount > prevCountRef.current) {
      setPulse(true)
      const timer = setTimeout(() => setPulse(false), 1000)
      return () => clearTimeout(timer)
    }
    prevCountRef.current = unreadCount
  }, [unreadCount, hasNew])

  const ariaLabel = unreadCount > 0
    ? t('notifications.badge.unread', '{count} unread notifications', { count: unreadCount })
    : t('notifications.title', 'Notifications')

  return (
    <>
      <IconButton
        variant="ghost"
        size="sm"
        className={cn('relative', className)}
        onClick={() => setPanelOpen(true)}
        aria-label={ariaLabel}
      >
        <Bell className={cn('h-5 w-5', pulse && 'animate-pulse')} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[10px] font-medium text-white dark:bg-destructive dark:text-destructive-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </IconButton>

      <NotificationPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAsRead={markAsRead}
        onExecuteAction={executeAction}
        onDismiss={dismiss}
        dismissUndo={dismissUndo}
        onUndoDismiss={undoDismiss}
        onMarkAllRead={markAllRead}
        t={t}
        customRenderers={customRenderers}
      />
    </>
  )
}
