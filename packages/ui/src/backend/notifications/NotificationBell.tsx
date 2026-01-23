"use client"
import * as React from 'react'
import { Bell } from 'lucide-react'
import { Button } from '../../primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import { useNotificationsPoll } from './useNotificationsPoll'
import { NotificationPanel } from './NotificationPanel'

export type NotificationBellProps = {
  className?: string
  t: (key: string, fallback?: string) => string
}

export function NotificationBell({ className, t }: NotificationBellProps) {
  const [panelOpen, setPanelOpen] = React.useState(false)
  const {
    unreadCount,
    hasNew,
    notifications,
    refresh,
    markAsRead,
    executeAction,
    dismiss,
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
    ? t('notifications.badge.unread', '{count} unread notifications').replace(
        '{count}',
        String(unreadCount)
      )
    : t('notifications.title', 'Notifications')

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn('relative', className)}
        onClick={() => setPanelOpen(true)}
        aria-label={ariaLabel}
      >
        <Bell className={cn('h-5 w-5', pulse && 'animate-pulse')} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      <NotificationPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        notifications={notifications}
        unreadCount={unreadCount}
        onRefresh={refresh}
        onMarkAsRead={markAsRead}
        onExecuteAction={executeAction}
        onDismiss={dismiss}
        onMarkAllRead={markAllRead}
        t={t}
      />
    </>
  )
}
