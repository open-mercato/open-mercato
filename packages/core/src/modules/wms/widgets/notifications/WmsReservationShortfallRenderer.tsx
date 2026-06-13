'use client'

import * as React from 'react'
import { AlertTriangle, ExternalLink, Loader2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'

export function WmsReservationShortfallRenderer({
  notification,
  onAction,
  onDismiss,
  actions = [],
}: NotificationRendererProps) {
  const t = useT()
  const router = useRouter()
  const [executing, setExecuting] = React.useState(false)
  const isUnread = notification.status === 'unread'
  const orderNumber = notification.bodyVariables?.orderNumber
  const shortfallCount = notification.bodyVariables?.shortfallCount

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
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleView()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="relative shrink-0 flex size-10 items-center justify-center rounded-full bg-status-warning-bg">
        <AlertTriangle className="size-5 text-status-warning-icon" aria-hidden="true" />
        {isUnread ? (
          <span
            className="absolute -right-1 -top-1 size-3 rounded-full bg-status-warning-icon ring-2 ring-background"
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-medium leading-5 tracking-tight text-foreground">
          {notification.title}
        </p>

        <div className="text-xs leading-4 text-muted-foreground">
          {timeAgo ? (
            <>
              <span className="whitespace-nowrap">{timeAgo}</span>
              <span aria-hidden="true" className="mx-1 text-text-disabled">·</span>
            </>
          ) : null}
          {orderNumber ? (
            <span className="whitespace-nowrap">
              {t('wms.notifications.reservationShortfall.renderer.order', 'Order')}: {orderNumber}
            </span>
          ) : null}
          {shortfallCount !== undefined ? (
            <>
              <span aria-hidden="true" className="mx-1 text-text-disabled">·</span>
              <span className="whitespace-nowrap font-medium text-foreground">
                {t('wms.notifications.reservationShortfall.renderer.lines', 'Lines with shortfall')}: {shortfallCount}
              </span>
            </>
          ) : null}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-md px-2.5 bg-accent-indigo text-accent-indigo-foreground hover:bg-accent-indigo/90"
            onClick={(event) => {
              event.stopPropagation()
              handleView()
            }}
            disabled={executing || (!viewAction && !notification.linkHref)}
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            {t('wms.notifications.reservationShortfall.renderer.viewReservations', 'View Reservations')}
            {executing ? <Loader2 className="ml-1 size-3 animate-spin" /> : null}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-md px-2.5"
            onClick={(event) => {
              event.stopPropagation()
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
        onClick={(event) => {
          event.stopPropagation()
          onDismiss()
        }}
        aria-label={t('notifications.actions.dismiss', 'Dismiss')}
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}

export default WmsReservationShortfallRenderer
