'use client'

import * as React from 'react'
import { Inbox, ExternalLink, Calendar } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'

export function ProposalCreatedRenderer({
  notification,
  onAction,
  onDismiss,
  actions = [],
}: NotificationRendererProps) {
  const t = useT()
  const router = useRouter()
  const [executing, setExecuting] = React.useState(false)
  const isUnread = notification.status === 'unread'
  const actionCount = notification.bodyVariables?.actionCount

  const reviewAction = actions.find((action) => action.id === 'review') ?? actions[0] ?? null

  const handleReview = async () => {
    if (!reviewAction) {
      if (notification.linkHref) router.push(notification.linkHref)
      return
    }
    setExecuting(true)
    try {
      await onAction(reviewAction.id)
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
      onClick={handleReview}
    >
      {isUnread && (
        <div className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />
      )}

      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
            <Inbox className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className={cn('text-sm font-medium', isUnread && 'font-semibold')}>
              {notification.title}
            </h4>
            <span className="flex-shrink-0 text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatRelativeTime(notification.createdAt, { translate: t }) ?? ''}
            </span>
          </div>

          {actionCount && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('inbox_ops.notifications.renderer.actionCount', '{count} proposed actions', { count: actionCount })}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                handleReview()
              }}
              disabled={executing || (!reviewAction && !notification.linkHref)}
              className="gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              {t('inbox_ops.action.review', 'Review')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                onDismiss()
              }}
            >
              {t('notifications.actions.dismiss', 'Dismiss')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ProposalCreatedRenderer
