'use client'

import * as React from 'react'
import { ShoppingCart, ExternalLink, DollarSign, User, Calendar } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'

function formatTimeAgo(dateString: string, t: (key: string, fallback?: string) => string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return t('common.time.justNow', 'just now')
  if (diffMins < 60) return t('common.time.minutesAgo', '{count}m ago').replace('{count}', String(diffMins))
  if (diffHours < 24) return t('common.time.hoursAgo', '{count}h ago').replace('{count}', String(diffHours))
  if (diffDays < 7) return t('common.time.daysAgo', '{count}d ago').replace('{count}', String(diffDays))
  return date.toLocaleDateString()
}

function parseOrderDetails(body?: string | null): { orderNumber?: string; total?: string } {
  if (!body) return {}
  const orderMatch = body.match(/order\s+([A-Z0-9\-\/]+)/i)
  const totalMatch = body.match(/\(([^)]+)\)/)
  return {
    orderNumber: orderMatch?.[1],
    total: totalMatch?.[1],
  }
}

export function SalesOrderCreatedRenderer({
  notification,
  onAction,
  onDismiss,
}: NotificationRendererProps) {
  const t = useT()
  const [executing, setExecuting] = React.useState(false)
  const isUnread = notification.status === 'unread'
  const details = parseOrderDetails(notification.body)

  const handleView = async () => {
    setExecuting(true)
    try {
      await onAction('view')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div
      className={cn(
        'group relative px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors border-l-4 border-l-blue-500',
        isUnread && 'bg-blue-50/50 dark:bg-blue-950/20'
      )}
      onClick={handleView}
    >
      {isUnread && (
        <div className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />
      )}

      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
            <ShoppingCart className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className={cn('text-sm font-medium', isUnread && 'font-semibold')}>
                {notification.title}
              </h4>
              {details.orderNumber && (
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    #{details.orderNumber}
                  </span>
                </div>
              )}
            </div>
            <span className="flex-shrink-0 text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatTimeAgo(notification.createdAt, t)}
            </span>
          </div>

          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            {details.total && (
              <div className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                <span className="font-medium text-foreground">{details.total}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              <span>{t('sales.notifications.renderer.assignedToYou', 'Assigned to you')}</span>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleView()
              }}
              disabled={executing}
              className="gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              {t('sales.notifications.renderer.viewOrder', 'View Order')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onDismiss()
              }}
            >
              {t('notifications.dismiss', 'Dismiss')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SalesOrderCreatedRenderer
