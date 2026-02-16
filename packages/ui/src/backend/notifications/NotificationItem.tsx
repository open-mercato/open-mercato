"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { X, Bell, AlertTriangle, CheckCircle2, XCircle, Info, Loader2 } from 'lucide-react'
import { Button } from '../../primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import type { NotificationDto, NotificationRendererProps, NotificationTypeAction } from '@open-mercato/shared/modules/notifications/types'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeTime } from '@open-mercato/ui/backend/detail'
import type { ComponentType } from 'react'

export type NotificationItemProps = {
  notification: NotificationDto
  onMarkAsRead: () => Promise<void>
  onExecuteAction: (actionId: string) => Promise<{ href?: string }>
  onDismiss: () => Promise<void>
  t: TranslateFn
  /**
   * Optional custom renderer component for this notification type.
   * When provided, this component will be used instead of the default rendering.
   *
   * Custom renderers receive full control over the notification's appearance while
   * still having access to action handlers and notification data.
   *
   * @example
   * ```tsx
   * // In your module's notifications.client.ts
   * export const salesNotificationTypes = [
   *   {
   *     type: 'sales.order.created',
   *     Renderer: SalesOrderCreatedRenderer,
   *     // ...other fields
   *   }
   * ]
   *
   * // Usage in NotificationPanel
   * const renderer = salesNotificationTypes.find(t => t.type === notification.type)?.Renderer
   * <NotificationItem
   *   notification={notification}
   *   customRenderer={renderer}
   *   ...
   * />
   * ```
   */
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

const severityColors = {
  info: 'text-blue-500',
  warning: 'text-amber-500',
  success: 'text-green-500',
  error: 'text-destructive',
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
  const severity = notification.severity as keyof typeof severityIcons
  const IconComponent = severityIcons[severity] ?? Bell
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

  const handleClick = async () => {
    if (isUnread) {
      await onMarkAsRead()
    }
    if (notification.linkHref) {
      router.push(notification.linkHref)
    }
  }

  const handleAction = async (actionId: string, event?: React.MouseEvent) => {
    event?.stopPropagation()
    setExecuting(actionId)
    try {
      const result = await onExecuteAction(actionId)
      if (result.href) {
        router.push(result.href)
      }
    } finally {
      setExecuting(null)
    }
  }

  const handleDismiss = async (event?: React.MouseEvent) => {
    event?.stopPropagation()
    await onDismiss()
  }

  // Convert notification actions to the format expected by custom renderers
  const rendererActions: NotificationTypeAction[] = notification.actions.map((action) => ({
    id: action.id,
    labelKey: action.labelKey ?? action.label,
    variant: action.variant as NotificationTypeAction['variant'],
    icon: action.icon,
  }))

  // Use custom renderer if provided
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

  return (
    <div
      className={cn(
        'group relative px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors',
        isUnread && 'bg-muted/30'
      )}
      onClick={handleClick}
    >
      {isUnread && (
        <div className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />
      )}

      <div className="flex gap-3">
        <div
          className={cn(
            'flex-shrink-0 mt-0.5',
            severityColors[severity] ?? 'text-muted-foreground'
          )}
        >
          <IconComponent className="h-5 w-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className={cn('text-sm font-medium', isUnread && 'font-semibold')}>
              {titleText}
            </h4>
            <span className="flex-shrink-0 text-xs text-muted-foreground">
              {formatRelativeTime(notification.createdAt, { translate: t }) ?? ''}
            </span>
          </div>

          {bodyText && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {bodyText}
            </p>
          )}

          {hasActions && notification.status !== 'actioned' && (
            <div className="mt-2 flex flex-wrap gap-2">
              {notification.actions.map((action) => (
                <Button
                  key={action.id}
                  variant={
                    (action.variant as 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost') ??
                    'outline'
                  }
                  size="sm"
                  onClick={(event) => handleAction(action.id, event)}
                  disabled={executing !== null}
                >
                  {action.labelKey
                    ? t(action.labelKey, action.label)
                    : t(action.label, action.label)}
                  {executing === action.id && (
                    <Loader2 className="ml-1 h-3 w-3 animate-spin" />
                  )}
                </Button>
              ))}
            </div>
          )}

          {notification.status === 'actioned' && notification.actionTaken && (
            <p className="mt-1 text-xs text-muted-foreground italic">
              {t('notifications.actionTaken', 'Action taken: {action}', {
                action: notification.actionTaken,
              })}
            </p>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="flex-shrink-0 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleDismiss}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
