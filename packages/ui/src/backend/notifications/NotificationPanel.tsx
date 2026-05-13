"use client"
import * as React from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Bell, Loader2, RotateCcw, Settings2, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { Sheet, SheetContent, SheetTitle } from '../../primitives/sheet'
import { NotificationItem } from './NotificationItem'
import type { NotificationDto, NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { ComponentType } from 'react'

/**
 * Map of notification type to custom renderer component.
 * Used to provide custom rendering for specific notification types.
 *
 * @example
 * ```tsx
 * const customRenderers = {
 *   'sales.order.created': SalesOrderCreatedRenderer,
 *   'sales.quote.created': SalesQuoteCreatedRenderer,
 * }
 * ```
 */
export type NotificationRenderers = Record<string, ComponentType<NotificationRendererProps>>

export type NotificationPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  notifications: NotificationDto[]
  unreadCount: number
  onMarkAsRead: (id: string) => Promise<void>
  onExecuteAction: (id: string, actionId: string) => Promise<{ href?: string }>
  onDismiss: (id: string) => Promise<void>
  dismissUndo?: { notification: NotificationDto; previousStatus: 'read' | 'unread' } | null
  onUndoDismiss?: () => Promise<void>
  onMarkAllRead: () => Promise<void>
  t: TranslateFn
  /**
   * Optional map of notification type to custom renderer component.
   * When a notification's type matches a key in this map, the corresponding
   * renderer will be used instead of the default NotificationItem rendering.
   *
   * @example
   * ```tsx
   * import { salesNotificationTypes } from '@open-mercato/core/modules/sales/notifications.client'
   *
   * // Build renderers map from notification types
   * const renderers = Object.fromEntries(
   *   salesNotificationTypes
   *     .filter(t => t.Renderer)
   *     .map(t => [t.type, t.Renderer!])
   * )
   *
   * <NotificationPanel customRenderers={renderers} ... />
   * ```
   */
  customRenderers?: NotificationRenderers
}

export function NotificationPanel({
  open,
  onOpenChange,
  notifications,
  unreadCount,
  onMarkAsRead,
  onExecuteAction,
  onDismiss,
  dismissUndo,
  onUndoDismiss,
  onMarkAllRead,
  t,
  customRenderers,
}: NotificationPanelProps) {
  const [filter, setFilter] = React.useState<'all' | 'unread' | 'action'>('all')
  const [markingAllRead, setMarkingAllRead] = React.useState(false)

  const filteredNotifications = React.useMemo(() => {
    switch (filter) {
      case 'unread':
        return notifications.filter((n) => n.status === 'unread')
      case 'action':
        return notifications.filter(
          (n) => n.actions && n.actions.length > 0 && n.status !== 'actioned'
        )
      default:
        return notifications
    }
  }, [notifications, filter])

  const handleMarkAllRead = async () => {
    setMarkingAllRead(true)
    try {
      await onMarkAllRead()
    } finally {
      setMarkingAllRead(false)
    }
  }

  // Preserve the body scroll lock contract that consumers (and integration
  // tests) rely on. Radix Dialog locks scroll via react-remove-scroll which
  // does not set `document.body.style.overflow` — we set it ourselves so the
  // contract is observable.
  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 p-0"
        hideClose
        aria-label={t('notifications.title', 'Notifications')}
      >
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <SheetTitle className="text-base font-medium leading-6 tracking-tight text-foreground">
            {t('notifications.title', 'Notifications')}
          </SheetTitle>
          <div className="flex items-center gap-1">
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={markingAllRead}
                className="inline-flex items-center gap-1 rounded-md px-1 text-sm font-medium leading-5 text-accent-indigo transition-colors hover:text-accent-indigo/80 disabled:opacity-50"
              >
                {markingAllRead ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t('notifications.markAllRead', 'Mark all read')}
              </button>
            ) : null}
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              aria-label={t('notifications.close', 'Close notifications')}
            >
              <X className="size-4" />
            </IconButton>
          </div>
        </div>

        <div role="tablist" className="flex items-center gap-5 border-b px-5 py-3.5">
          {(['all', 'unread', 'action'] as const).map((value) => {
            const isActive = filter === value
            const label =
              value === 'all'
                ? t('notifications.filters.all', 'All')
                : value === 'unread'
                  ? t('notifications.filters.unread', 'Unread')
                  : t('notifications.filters.actionRequired', 'Action Required')
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter(value)}
                className="relative inline-flex items-center gap-1.5 pb-2 text-sm font-medium leading-5 tracking-tight transition-colors focus:outline-none focus-visible:text-foreground data-[active=true]:text-foreground data-[active=false]:text-muted-foreground hover:text-foreground"
                data-active={isActive}
              >
                <span>{label}</span>
                {value === 'unread' && unreadCount > 0 ? (
                  <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-accent-indigo px-1 text-[10px] font-medium text-accent-indigo-foreground">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                ) : null}
                {isActive ? (
                  <span
                    className="absolute bottom-[-14px] left-0 right-0 h-0.5 bg-foreground"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            )
          })}
        </div>

        {dismissUndo && onUndoDismiss && (
          <div className="border-b bg-muted/50 px-4 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span>
                {t('notifications.toast.dismissed', 'Notification dismissed')}
              </span>
              <Button variant="ghost" size="sm" onClick={() => onUndoDismiss()}>
                <RotateCcw className="mr-1 h-3 w-3" />
                {t('notifications.actions.undo', 'Undo')}
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          {filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted/50">
                <Bell className="size-5" aria-hidden="true" />
              </div>
              <p className="text-sm">{t('notifications.empty', 'No notifications')}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1 p-2">
              {filteredNotifications.map((notification, idx) => (
                <React.Fragment key={notification.id}>
                  {idx > 0 ? <div className="my-px h-px bg-border" aria-hidden="true" /> : null}
                  <NotificationItem
                    notification={notification}
                    onMarkAsRead={() => onMarkAsRead(notification.id)}
                    onExecuteAction={(actionId) => onExecuteAction(notification.id, actionId)}
                    onDismiss={() => onDismiss(notification.id)}
                    t={t}
                    customRenderer={customRenderers?.[notification.type]}
                  />
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-3.5 text-xs leading-4 text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>{t('notifications.footer.useHint', 'Use')}</span>
            <span className="inline-flex items-center rounded border bg-muted/50 px-1 py-0.5">
              <ArrowUp className="size-3" aria-hidden="true" />
            </span>
            <span className="inline-flex items-center rounded border bg-muted/50 px-1 py-0.5">
              <ArrowDown className="size-3" aria-hidden="true" />
            </span>
            <span>{t('notifications.footer.toNavigate', 'to navigate')}</span>
          </div>
          <Link
            href="/backend/config/notifications"
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings2 className="size-3.5" aria-hidden="true" />
            {t('notifications.footer.manage', 'Manage notifications')}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  )
}
