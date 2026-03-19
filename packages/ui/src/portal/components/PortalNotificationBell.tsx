"use client"
import * as React from 'react'
import { IconButton } from '../../primitives/icon-button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { usePortalNotifications } from '../hooks/usePortalNotifications'
import { PortalNotificationPanel } from './PortalNotificationPanel'

function BellIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

type PortalNotificationBellProps = {
  t: TranslateFn
}

/**
 * Portal notification bell icon with unread badge and slide-over panel.
 * Renders in the portal header. Uses portal-specific notification endpoints.
 */
export function PortalNotificationBell({ t }: PortalNotificationBellProps) {
  const [panelOpen, setPanelOpen] = React.useState(false)
  const {
    notifications,
    unreadCount,
    hasNew,
    markAsRead,
    dismiss,
    markAllRead,
  } = usePortalNotifications()

  const [pulse, setPulse] = React.useState(false)
  const prevCountRef = React.useRef(unreadCount)

  React.useEffect(() => {
    if (hasNew && unreadCount > prevCountRef.current) {
      setPulse(true)
      const timer = setTimeout(() => setPulse(false), 1200)
      return () => clearTimeout(timer)
    }
    prevCountRef.current = unreadCount
  }, [unreadCount, hasNew])

  return (
    <>
      <IconButton
        variant="ghost"
        size="sm"
        type="button"
        className="relative"
        onClick={() => setPanelOpen(true)}
        aria-label={
          unreadCount > 0
            ? t('portal.notifications.badge', '{count} unread', { count: unreadCount })
            : t('portal.notifications.title', 'Notifications')
        }
      >
        <BellIcon className={`size-[18px] ${pulse ? 'animate-pulse' : ''}`} />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-foreground text-[9px] font-bold text-background">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </IconButton>

      <PortalNotificationPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAsRead={markAsRead}
        onDismiss={dismiss}
        onMarkAllRead={markAllRead}
        t={t}
      />
    </>
  )
}
