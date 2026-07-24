'use client'

import * as React from 'react'
import {
  ClipboardCheck,
  ExternalLink,
  Loader2,
  MessageSquare,
  RefreshCw,
  UserCheck,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { cn } from '@open-mercato/shared/lib/utils'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'

type ClaimNotificationType =
  | 'warranty_claims.claim.submitted'
  | 'warranty_claims.claim.assigned'
  | 'warranty_claims.claim.status_changed'
  | 'warranty_claims.claim.customer_replied'

type ClaimNotificationMeta = {
  Icon: LucideIcon
  titleKey: string
  bodyKey: string
  fallbackTitle: string
  fallbackBody: string
  tone: 'info' | 'warning'
}

const notificationMeta: Record<ClaimNotificationType, ClaimNotificationMeta> = {
  'warranty_claims.claim.submitted': {
    Icon: ClipboardCheck,
    titleKey: 'warranty_claims.notifications.submitted.title',
    bodyKey: 'warranty_claims.notifications.submitted.body',
    fallbackTitle: 'Claim submitted',
    fallbackBody: 'A warranty claim has been submitted for review.',
    tone: 'info',
  },
  'warranty_claims.claim.assigned': {
    Icon: UserCheck,
    titleKey: 'warranty_claims.notifications.assigned.title',
    bodyKey: 'warranty_claims.notifications.assigned.body',
    fallbackTitle: 'Claim assigned',
    fallbackBody: 'A warranty claim has been assigned.',
    tone: 'info',
  },
  'warranty_claims.claim.status_changed': {
    Icon: RefreshCw,
    titleKey: 'warranty_claims.notifications.statusChanged.title',
    bodyKey: 'warranty_claims.notifications.statusChanged.body',
    fallbackTitle: 'Claim status changed',
    fallbackBody: 'A warranty claim status changed.',
    tone: 'warning',
  },
  'warranty_claims.claim.customer_replied': {
    Icon: MessageSquare,
    titleKey: 'warranty_claims.notifications.customerReplied.title',
    bodyKey: 'warranty_claims.notifications.customerReplied.body',
    fallbackTitle: 'Customer replied',
    fallbackBody: 'A customer replied on a warranty claim.',
    tone: 'info',
  },
}

const toneClasses: Record<ClaimNotificationMeta['tone'], {
  avatar: string
  icon: string
  border: string
  unread: string
}> = {
  info: {
    avatar: 'bg-status-info-bg',
    icon: 'text-status-info-icon',
    border: 'border-l-status-info-border',
    unread: 'bg-status-info-bg',
  },
  warning: {
    avatar: 'bg-status-warning-bg',
    icon: 'text-status-warning-icon',
    border: 'border-l-status-warning-border',
    unread: 'bg-status-warning-bg',
  },
}

function isClaimNotificationType(type: string): type is ClaimNotificationType {
  return Object.prototype.hasOwnProperty.call(notificationMeta, type)
}

function getNotificationMeta(type: string): ClaimNotificationMeta {
  return notificationMeta[isClaimNotificationType(type) ? type : 'warranty_claims.claim.submitted']
}

function fallbackText(value: string | null | undefined, key: string, fallback: string): string {
  if (!value || value === key) return fallback
  return value
}

function translateText(
  t: TranslateFn,
  key: string,
  fallback: string,
  variables: Record<string, string> | null | undefined,
): string {
  return t(key, fallback, variables ?? undefined)
}

function resolveClaimHref(notification: NotificationRendererProps['notification']): string {
  if (notification.linkHref && !notification.linkHref.includes('{sourceEntityId}')) return notification.linkHref
  if (notification.sourceEntityId) return `/backend/warranty_claims/${notification.sourceEntityId}`
  return '/backend/warranty_claims'
}

export function WarrantyClaimNotificationRenderer({
  notification,
  onAction,
  onDismiss,
  actions = [],
}: NotificationRendererProps) {
  const t = useT()
  const router = useRouter()
  const [executing, setExecuting] = React.useState(false)
  const meta = getNotificationMeta(notification.type)
  const classes = toneClasses[meta.tone]
  const isUnread = notification.status === 'unread'
  const claimNumber = notification.bodyVariables?.claimNumber ?? notification.titleVariables?.claimNumber
  const viewAction = actions.find((action) => action.id === 'view') ?? actions[0] ?? null
  const href = resolveClaimHref(notification)
  const timeAgo = formatRelativeTime(notification.createdAt, { translate: t }) ?? ''
  const title = translateText(
    t,
    notification.titleKey ?? meta.titleKey,
    fallbackText(notification.title, notification.titleKey ?? meta.titleKey, meta.fallbackTitle),
    notification.titleVariables,
  )
  const body = translateText(
    t,
    notification.bodyKey ?? meta.bodyKey,
    fallbackText(notification.body, notification.bodyKey ?? meta.bodyKey, meta.fallbackBody),
    notification.bodyVariables,
  )

  const handleView = async () => {
    if (!viewAction) {
      router.push(href)
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
        'group relative flex cursor-pointer items-start gap-3 rounded-xl border-l-4 p-3 transition-colors hover:bg-muted/40',
        classes.border,
        isUnread && classes.unread,
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
      <div className={cn('relative flex size-10 shrink-0 items-center justify-center rounded-full', classes.avatar)}>
        <meta.Icon className={cn('size-5', classes.icon)} aria-hidden="true" />
        {isUnread ? (
          <span
            className="absolute -right-1 -top-1 size-3 rounded-full bg-accent-indigo ring-2 ring-background"
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-medium leading-5 text-foreground">{title}</p>
        <div className="flex flex-wrap items-center gap-1 text-xs leading-4 text-muted-foreground">
          {timeAgo ? <span className="whitespace-nowrap">{timeAgo}</span> : null}
          {timeAgo && claimNumber ? <span aria-hidden="true" className="text-text-disabled">·</span> : null}
          {claimNumber ? (
            <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 font-mono text-overline text-foreground">
              <span className="truncate">#{claimNumber}</span>
            </span>
          ) : null}
        </div>
        {body ? (
          <div className="mt-2 inline-flex max-w-full self-start rounded-tr-lg rounded-br-lg rounded-bl-lg rounded-tl-sm border border-border bg-background px-3 py-2 text-sm leading-5 text-muted-foreground shadow-xs">
            <p className="line-clamp-2 break-words">{body}</p>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={(event) => {
              event.stopPropagation()
              handleView()
            }}
            disabled={executing}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            {t('common.view', 'View')}
            {executing ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
          </Button>
          <Button
            type="button"
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
        <X className="size-4" aria-hidden="true" />
      </IconButton>
    </div>
  )
}

export default WarrantyClaimNotificationRenderer
