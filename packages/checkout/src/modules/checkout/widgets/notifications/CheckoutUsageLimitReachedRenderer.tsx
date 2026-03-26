'use client'

import * as React from 'react'
import { AlertTriangle, ExternalLink, Calendar } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'

export function CheckoutUsageLimitReachedRenderer({
  notification,
  onAction,
  onDismiss,
  actions = [],
}: NotificationRendererProps) {
  const t = useT()
  const router = useRouter()
  const [executing, setExecuting] = React.useState(false)
  const isUnread = notification.status === 'unread'

  const linkName = notification.bodyVariables?.linkName ?? ''
  const viewAction = actions.find((action) => action.id === 'view') ?? actions[0] ?? null

  const handleView = async () => {
    if (!viewAction) {
      if (notification.linkHref) router.push(notification.linkHref)
      return
    }
    setExecuting(true)
    try {
      await onAction(viewAction.id)
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div
      className={cn(
        'group relative px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors border-l-4 border-l-amber-500',
        isUnread && 'bg-amber-50/50 dark:bg-amber-950/20',
      )}
      onClick={handleView}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleView()
        }
      }}
      role="button"
      tabIndex={0}
    >
      {isUnread && (
        <div className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />
      )}
      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className={cn('text-sm font-medium', isUnread && 'font-semibold')}>
                {notification.title}
              </h4>
              {linkName ? (
                <span className="text-xs text-muted-foreground">{linkName}</span>
              ) : null}
            </div>
            <span className="flex-shrink-0 text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatRelativeTime(notification.createdAt, { translate: t }) ?? ''}
            </span>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={(e) => { e.stopPropagation(); handleView() }}
              disabled={executing || (!viewAction && !notification.linkHref)}
              className="gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              {t('checkout.notifications.renderer.viewLink', 'View Pay Link')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onDismiss() }}
            >
              {t('notifications.actions.dismiss', 'Dismiss')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CheckoutUsageLimitReachedRenderer
