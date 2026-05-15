'use client'

import * as React from 'react'
import { ShoppingCart, ExternalLink, Loader2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'
import { formatMoney } from '../../components/documents/lineItemUtils'
import { useSalesDocumentTotals } from './useSalesDocumentTotals'

function normalizeTotal(value?: string | null): string | null {
  if (!value) return null
  let trimmed = value.trim()
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    trimmed = trimmed.slice(1, -1).trim()
  }
  return trimmed.length ? trimmed : null
}

export function SalesOrderCreatedRenderer({
  notification,
  onAction,
  onDismiss,
  actions = [],
}: NotificationRendererProps) {
  const t = useT()
  const router = useRouter()
  const [executing, setExecuting] = React.useState(false)
  const isUnread = notification.status === 'unread'
  const orderNumber = notification.bodyVariables?.orderNumber ?? notification.titleVariables?.orderNumber
  const fallbackTotal =
    normalizeTotal(notification.bodyVariables?.totalAmount ?? null) ??
    normalizeTotal(notification.bodyVariables?.total ?? null)
  const { totals } = useSalesDocumentTotals('order', notification.sourceEntityId)

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

  const timeAgo = formatRelativeTime(notification.createdAt, { translate: t }) ?? ''

  return (
    <div
      className={cn(
        'group relative flex gap-4 items-start rounded-xl p-3 transition-colors hover:bg-muted/40 cursor-pointer',
        isUnread && 'bg-muted/20',
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
      {/* Avatar: indigo-tinted circle with shopping-cart icon */}
      <div className="relative shrink-0 flex size-10 items-center justify-center rounded-full bg-status-info-bg">
        <ShoppingCart className="size-5 text-status-info-icon" aria-hidden="true" />
        {isUnread ? (
          <span
            className="absolute -right-1 -top-1 size-3 rounded-full bg-accent-indigo ring-2 ring-background"
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Title row */}
        <p className="truncate text-sm font-medium leading-5 tracking-tight text-foreground">
          {notification.title}
        </p>

        {/* Description row: time · order# · total · assigned — inline so it wraps naturally per line */}
        <div className="text-xs leading-4 text-muted-foreground">
          {timeAgo ? (
            <>
              <span className="whitespace-nowrap">{timeAgo}</span>
              <span aria-hidden="true" className="mx-1 text-text-disabled">·</span>
            </>
          ) : null}
          {orderNumber ? (
            <>
              <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-overline text-foreground">
                #{orderNumber}
              </span>
              <span aria-hidden="true" className="mx-1 text-text-disabled">·</span>
            </>
          ) : null}
          {currentTotal ? (
            <>
              <span className="whitespace-nowrap font-medium text-foreground">{currentTotal}</span>
              <span aria-hidden="true" className="mx-1 text-text-disabled">·</span>
            </>
          ) : null}
          <span className="whitespace-nowrap">{t('sales.notifications.renderer.assignedToYou', 'Assigned to you')}</span>
        </div>

        {/* Actions row */}
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-md px-2.5 bg-accent-indigo text-accent-indigo-foreground hover:bg-accent-indigo/90"
            onClick={(e) => {
              e.stopPropagation()
              handleView()
            }}
            disabled={executing || (!viewAction && !notification.linkHref)}
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            {t('sales.notifications.renderer.viewOrder', 'View Order')}
            {executing ? <Loader2 className="ml-1 size-3 animate-spin" /> : null}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-md px-2.5"
            onClick={(e) => {
              e.stopPropagation()
              onDismiss()
            }}
          >
            {t('notifications.actions.dismiss', 'Dismiss')}
          </Button>
        </div>
      </div>

      <IconButton
        type="button"
        variant="ghost"
        size="xs"
        className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={(e) => {
          e.stopPropagation()
          onDismiss()
        }}
        aria-label={t('notifications.actions.dismiss', 'Dismiss')}
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}

export default SalesOrderCreatedRenderer
