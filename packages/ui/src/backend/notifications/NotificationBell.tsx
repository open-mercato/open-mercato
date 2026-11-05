"use client"
import * as React from 'react'
import { Bell } from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { IconButton } from '../../primitives/icon-button'
import { cn } from '@open-mercato/shared/lib/utils'
import { useNotifications } from './useNotifications'
import { NotificationPanel } from './NotificationPanel'
import { NotificationCountBadge } from './NotificationCountBadge'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRenderers } from './NotificationPanel'

export type NotificationBellProps = {
  className?: string
  t: TranslateFn
  customRenderers?: NotificationRenderers
}

export function NotificationBell({ className, t, customRenderers }: NotificationBellProps) {
  const [panelOpen, setPanelOpen] = React.useState(false)
  const pathname = usePathname()
  const searchParams = useSearchParams()
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
  } = useNotifications()
  const prevCountRef = React.useRef(unreadCount)
  const routeKey = React.useMemo(() => {
    const query = searchParams.toString()
    return query ? `${pathname}?${query}` : pathname
  }, [pathname, searchParams])
  const previousRouteKeyRef = React.useRef(routeKey)
  const [pulse, setPulse] = React.useState(false)

  React.useEffect(() => {
    if (hasNew && unreadCount > prevCountRef.current) {
      setPulse(true)
      const timer = setTimeout(() => setPulse(false), 1000)
      return () => clearTimeout(timer)
    }
    prevCountRef.current = unreadCount
  }, [unreadCount, hasNew])

  React.useEffect(() => {
    if (panelOpen && routeKey !== previousRouteKeyRef.current) {
      setPanelOpen(false)
    }
    previousRouteKeyRef.current = routeKey
  }, [panelOpen, routeKey])

  const ariaLabel = unreadCount > 0
    ? t('notifications.badge.unread', '{count} unread notifications', { count: unreadCount })
    : t('notifications.title', 'Notifications')

  return (
    <>
      <IconButton
        variant="ghost"
        size="sm"
        type="button"
        className={cn('relative', className)}
        onClick={() => setPanelOpen(true)}
        aria-label={ariaLabel}
      >
        <Bell className={cn('h-5 w-5', pulse && 'animate-pulse')} />
        <NotificationCountBadge count={unreadCount} />
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
