"use client"
import * as React from 'react'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

function XIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  error: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
}

type Tab = 'all' | 'unread'

type PortalNotificationPanelProps = {
  open: boolean
  onClose: () => void
  notifications: NotificationDto[]
  unreadCount: number
  onMarkAsRead: (id: string) => Promise<void>
  onDismiss: (id: string) => Promise<void>
  onMarkAllRead: () => Promise<void>
  t: TranslateFn
}

export function PortalNotificationPanel({
  open,
  onClose,
  notifications,
  unreadCount,
  onMarkAsRead,
  onDismiss,
  onMarkAllRead,
  t,
}: PortalNotificationPanelProps) {
  const [tab, setTab] = React.useState<Tab>('all')
  const panelRef = React.useRef<HTMLDivElement>(null)

  // Close on Escape
  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const filtered = tab === 'unread'
    ? notifications.filter((n) => n.status === 'unread')
    : notifications

  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return t('portal.notifications.justNow', 'Just now')
    if (mins < 60) return t('portal.notifications.minutesAgo', '{m}m ago', { m: mins })
    const hours = Math.floor(mins / 60)
    if (hours < 24) return t('portal.notifications.hoursAgo', '{h}h ago', { h: hours })
    const days = Math.floor(hours / 24)
    return t('portal.notifications.daysAgo', '{d}d ago', { d: days })
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l bg-background shadow-2xl"
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b px-5">
          <div>
            <h2 className="text-[15px] font-semibold">{t('portal.notifications.title', 'Notifications')}</h2>
            {unreadCount > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t('portal.notifications.unreadSummary', '{count} unread', { count: unreadCount })}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-[12px] text-muted-foreground"
                onClick={() => onMarkAllRead()}
              >
                <CheckIcon className="mr-1 size-3.5" />
                {t('portal.notifications.markAllRead', 'Mark all read')}
              </Button>
            ) : null}
            <IconButton variant="ghost" size="sm" type="button" onClick={onClose} aria-label="Close">
              <XIcon className="size-4" />
            </IconButton>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b px-5">
          {(['all', 'unread'] as Tab[]).map((tabId) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setTab(tabId)}
              className={`border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
                tab === tabId
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tabId === 'all'
                ? t('portal.notifications.tab.all', 'All')
                : t('portal.notifications.tab.unread', 'Unread')}
              {tabId === 'unread' && unreadCount > 0 ? (
                <span className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
                  {unreadCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm font-medium text-muted-foreground">
                {tab === 'unread'
                  ? t('portal.notifications.emptyUnread', 'All caught up!')
                  : t('portal.notifications.empty', 'No notifications yet')}
              </p>
            </div>
          ) : (
            filtered.map((notification) => (
              <div
                key={notification.id}
                className={`flex gap-3 border-b px-5 py-4 transition-colors ${
                  notification.status === 'unread' ? 'bg-muted/30' : ''
                }`}
              >
                {/* Severity dot */}
                <div className={`mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${SEVERITY_STYLES[notification.severity] ?? SEVERITY_STYLES.info}`}>
                  {notification.severity.charAt(0).toUpperCase()}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-medium leading-snug">
                      {notification.title}
                    </p>
                    <span className="shrink-0 text-[11px] text-muted-foreground/60">
                      {formatTime(notification.createdAt)}
                    </span>
                  </div>
                  {notification.body ? (
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                      {notification.body}
                    </p>
                  ) : null}

                  {/* Actions */}
                  <div className="mt-2 flex items-center gap-2">
                    {notification.status === 'unread' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-2 py-1 text-[11px] text-muted-foreground"
                        onClick={() => onMarkAsRead(notification.id)}
                      >
                        {t('portal.notifications.markRead', 'Mark read')}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto px-2 py-1 text-[11px] text-muted-foreground"
                      onClick={() => onDismiss(notification.id)}
                    >
                      {t('portal.notifications.dismiss', 'Dismiss')}
                    </Button>
                    {notification.linkHref ? (
                      <a
                        href={notification.linkHref}
                        className="ml-auto text-[11px] font-medium text-foreground underline underline-offset-2 hover:opacity-80"
                        onClick={() => {
                          if (notification.status === 'unread') onMarkAsRead(notification.id)
                          onClose()
                        }}
                      >
                        {t('portal.notifications.view', 'View')}
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
