"use client"
import * as React from 'react'
import { X, Bell, CheckCheck, Loader2 } from 'lucide-react'
import { Button } from '../../primitives/button'
import { Tabs, TabsList, TabsTrigger } from '../../primitives/tabs'
import { cn } from '@open-mercato/shared/lib/utils'
import { NotificationItem } from './NotificationItem'
import type { NotificationDto } from './types'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'
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
  onRefresh: () => void
  onMarkAsRead: (id: string) => Promise<void>
  onExecuteAction: (id: string, actionId: string) => Promise<{ href?: string }>
  onDismiss: (id: string) => Promise<void>
  onMarkAllRead: () => Promise<void>
  t: (key: string, fallback?: string) => string
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
  onMarkAllRead,
  t,
  customRenderers,
}: NotificationPanelProps) {
  const [filter, setFilter] = React.useState<'all' | 'unread' | 'action'>('all')
  const [markingAllRead, setMarkingAllRead] = React.useState(false)
  const panelRef = React.useRef<HTMLDivElement>(null)

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

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md border-l bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={t('notifications.title', 'Notifications')}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              <h2 className="font-semibold">{t('notifications.title', 'Notifications')}</h2>
              {unreadCount > 0 && (
                <span className="rounded-full bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllRead}
                  disabled={markingAllRead}
                >
                  {markingAllRead ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCheck className="mr-1 h-4 w-4" />
                  )}
                  {t('notifications.markAllRead', 'Mark all read')}
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <Tabs
            value={filter}
            onValueChange={(v) => setFilter(v as typeof filter)}
            className="border-b"
          >
            <TabsList className="w-full justify-start rounded-none border-0 bg-transparent px-4">
              <TabsTrigger value="all">
                {t('notifications.filters.all', 'All')}
              </TabsTrigger>
              <TabsTrigger value="unread">
                {t('notifications.filters.unread', 'Unread')}
              </TabsTrigger>
              <TabsTrigger value="action">
                {t('notifications.filters.actionRequired', 'Action Required')}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex-1 overflow-y-auto">
            {filteredNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Bell className="mb-2 h-8 w-8 opacity-50" />
                <p>{t('notifications.empty', 'No notifications')}</p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredNotifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onMarkAsRead={() => onMarkAsRead(notification.id)}
                    onExecuteAction={(actionId) => onExecuteAction(notification.id, actionId)}
                    onDismiss={() => onDismiss(notification.id)}
                    t={t}
                    customRenderer={customRenderers?.[notification.type]}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
