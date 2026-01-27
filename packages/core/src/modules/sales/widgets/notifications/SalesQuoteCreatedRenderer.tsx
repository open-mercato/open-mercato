'use client'

import * as React from 'react'
import { FileText, ExternalLink, DollarSign, User, Calendar } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'
import { formatMoney } from '../../components/documents/lineItemUtils'
import { useSalesDocumentTotals } from './useSalesDocumentTotals'

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

function normalizeTotal(value?: string | null): string | null {
  if (!value) return null
  let trimmed = value.trim()
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    trimmed = trimmed.slice(1, -1).trim()
  }
  return trimmed.length ? trimmed : null
}

export function SalesQuoteCreatedRenderer({
  notification,
  onAction,
  onDismiss,
}: NotificationRendererProps) {
  const t = useT()
  const router = useRouter()
  const [executing, setExecuting] = React.useState(false)
  const isUnread = notification.status === 'unread'
  const quoteNumber = notification.bodyVariables?.quoteNumber ?? notification.titleVariables?.quoteNumber
  const fallbackTotal =
    normalizeTotal(notification.bodyVariables?.totalAmount ?? null) ??
    normalizeTotal(notification.bodyVariables?.total ?? null)
  const { totals } = useSalesDocumentTotals('quote', notification.sourceEntityId)

  const currentTotal =
    totals && typeof totals.grandTotalGrossAmount === 'number'
      ? formatMoney(totals.grandTotalGrossAmount, totals.currencyCode)
      : fallbackTotal

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
        isUnread && 'bg-amber-50/50 dark:bg-amber-950/20'
      )}
      onClick={handleView}
    >
      {isUnread && (
        <div className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />
      )}

      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
            <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className={cn('text-sm font-medium', isUnread && 'font-semibold')}>
                {notification.title}
              </h4>
              {quoteNumber && (
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    #{quoteNumber}
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
            {currentTotal && (
              <div className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                <span className="font-medium text-foreground">{currentTotal}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              <span>{t('sales.notifications.renderer.pendingReview', 'Pending review')}</span>
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
              disabled={executing || (!viewAction && !notification.linkHref)}
              className="gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              {t('sales.notifications.renderer.viewQuote', 'View Quote')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
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

export default SalesQuoteCreatedRenderer
