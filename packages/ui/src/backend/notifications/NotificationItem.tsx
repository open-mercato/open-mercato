"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Bell, AlertTriangle, CheckCircle2, XCircle, Info, Loader2, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import type { NotificationDto, NotificationRendererProps, NotificationTypeAction } from '@open-mercato/shared/modules/notifications/types'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { ComponentType } from 'react'

export type NotificationItemProps = {
  notification: NotificationDto
  onMarkAsRead: () => Promise<void>
  onExecuteAction: (actionId: string) => Promise<{ href?: string }>
  onDismiss: () => Promise<void>
  t: TranslateFn
  customRenderer?: ComponentType<NotificationRendererProps>
}

function resolveNotificationText(params: {
  key?: string | null
  fallback?: string | null
  variables?: Record<string, string> | null
  t: TranslateFn
}): string {
  const { key, fallback, variables, t } = params
  if (key) {
    return t(key, fallback ?? key, variables ?? undefined)
  }
  if (fallback) {
    return t(fallback, variables ?? undefined)
  }
  return ''
}

const severityIcons = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle2,
  error: XCircle,
}

// Avatar background — soft tints matching the Figma example item palette
const severityAvatarBg = {
  info: 'bg-status-info-bg',
  warning: 'bg-status-warning-bg',
  success: 'bg-status-success-bg',
  error: 'bg-status-error-bg',
}

const severityAvatarText = {
  info: 'text-status-info-icon',
  warning: 'text-status-warning-icon',
  success: 'text-status-success-icon',
  error: 'text-status-error-icon',
}

function humanizeModuleId(moduleId?: string | null): string | null {
  if (!moduleId) return null
  return moduleId
    .split(/[_:.-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function NotificationItem({
  notification,
  onMarkAsRead,
  onExecuteAction,
  onDismiss,
  t,
  customRenderer: CustomRenderer,
}: NotificationItemProps) {
  const router = useRouter()
  const [executing, setExecuting] = React.useState<string | null>(null)

  const isUnread = notification.status === 'unread'
  const hasActions = notification.actions && notification.actions.length > 0
  const severity = (notification.severity as keyof typeof severityIcons) ?? 'info'
  const IconComponent = severityIcons[severity] ?? Bell
  const avatarBg = severityAvatarBg[severity] ?? 'bg-muted'
  const avatarText = severityAvatarText[severity] ?? 'text-muted-foreground'

  const titleText = resolveNotificationText({
    key: notification.titleKey,
    fallback: notification.title,
    variables: notification.titleVariables ?? undefined,
    t,
  })
  const bodyText = resolveNotificationText({
    key: notification.bodyKey,
    fallback: notification.body ?? undefined,
    variables: notification.bodyVariables ?? undefined,
    t,
  })
  const timeAgo = formatRelativeTime(notification.createdAt, { translate: t }) ?? ''
  const sourceLabel = humanizeModuleId(notification.sourceModule)

  const handleClick = async () => {
    if (isUnread) await onMarkAsRead()
    if (notification.linkHref) router.push(notification.linkHref)
  }

  const handleAction = async (actionId: string, event?: React.MouseEvent) => {
    event?.stopPropagation()
    setExecuting(actionId)
    try {
      const result = await onExecuteAction(actionId)
      if (result.href) router.push(result.href)
    } finally {
      setExecuting(null)
    }
  }

  const handleDismiss = async (event?: React.MouseEvent) => {
    event?.stopPropagation()
    await onDismiss()
  }

  const rendererActions: NotificationTypeAction[] = notification.actions.map((action) => ({
    id: action.id,
    labelKey: action.labelKey ?? action.label,
    variant: action.variant as NotificationTypeAction['variant'],
    icon: action.icon,
  }))

  if (CustomRenderer) {
    return (
      <CustomRenderer
        notification={{
          id: notification.id,
          type: notification.type,
          title: titleText,
          body: bodyText || null,
          titleKey: notification.titleKey,
          bodyKey: notification.bodyKey,
          titleVariables: notification.titleVariables ?? null,
          bodyVariables: notification.bodyVariables ?? null,
          icon: notification.icon,
          severity: notification.severity,
          status: notification.status,
          sourceModule: notification.sourceModule,
          sourceEntityType: notification.sourceEntityType,
          sourceEntityId: notification.sourceEntityId,
          linkHref: notification.linkHref ?? null,
          createdAt: notification.createdAt,
        }}
        onAction={handleAction}
        onDismiss={handleDismiss}
        actions={rendererActions}
      />
    )
  }

  const showActions = hasActions && notification.status !== 'actioned'
  const showBodyBubble = !!bodyText && bodyText.length > 0

  return (
    <div
      className={cn(
        'group relative flex gap-4 items-start rounded-xl p-3 transition-colors hover:bg-muted/40 cursor-pointer',
        isUnread && 'bg-muted/20'
      )}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
      role="button"
      tabIndex={0}
    >
      {/* Avatar: severity-tinted circle with severity icon */}
      <div className={cn('relative shrink-0 flex size-10 items-center justify-center rounded-full', avatarBg)}>
        <IconComponent className={cn('size-5', avatarText)} aria-hidden="true" />
        {isUnread ? (
          <span
            className="absolute -right-1 -top-1 size-3 rounded-full bg-accent-indigo ring-2 ring-background"
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Title row */}
        <p className="text-sm font-medium leading-5 tracking-tight text-foreground">
          {titleText}
        </p>

        {/* Description row: time · source */}
        <div className="flex flex-wrap items-center gap-1 text-xs leading-4 text-muted-foreground">
          {timeAgo ? <span className="whitespace-nowrap">{timeAgo}</span> : null}
          {timeAgo && sourceLabel ? (
            <span aria-hidden="true" className="text-text-disabled">·</span>
          ) : null}
          {sourceLabel ? <span className="truncate">{sourceLabel}</span> : null}
        </div>

        {/* Optional body bubble */}
        {showBodyBubble ? (
          <div className="mt-2 inline-flex max-w-full self-start rounded-tr-lg rounded-br-lg rounded-bl-lg rounded-tl-sm border bg-background px-3 py-2 text-sm leading-5 tracking-tight text-muted-foreground shadow-xs">
            <p className="whitespace-pre-line break-words">{bodyText}</p>
          </div>
        ) : null}

        {/* Optional actions row */}
        {showActions ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {notification.actions.map((action, idx) => {
              const isPrimary = idx === notification.actions.length - 1 || action.variant === 'default'
              return (
                <Button
                  key={action.id}
                  type="button"
                  variant={isPrimary ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'h-8 rounded-md px-2.5 py-1.5 text-sm font-medium',
                    isPrimary && 'bg-accent-indigo text-accent-indigo-foreground hover:bg-accent-indigo/90',
                  )}
                  onClick={(event) => handleAction(action.id, event)}
                  disabled={executing !== null}
                >
                  {action.labelKey ? t(action.labelKey, action.label) : t(action.label, action.label)}
                  {executing === action.id ? <Loader2 className="ml-1 size-3 animate-spin" /> : null}
                </Button>
              )
            })}
          </div>
        ) : null}

        {notification.status === 'actioned' && notification.actionTaken ? (
          <p className="mt-1 text-xs italic text-muted-foreground">
            {t('notifications.actionTaken', 'Action taken: {action}', { action: notification.actionTaken })}
          </p>
        ) : null}
      </div>

      <IconButton
        type="button"
        variant="ghost"
        size="xs"
        className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={handleDismiss}
        aria-label={t('notifications.actions.dismiss', 'Dismiss')}
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}
