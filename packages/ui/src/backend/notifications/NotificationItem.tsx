"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { X, Bell, AlertTriangle, CheckCircle2, XCircle, Info, Loader2 } from 'lucide-react'
import { Button } from '../../primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import type { NotificationDto } from './types'

export type NotificationItemProps = {
  notification: NotificationDto
  onMarkAsRead: () => Promise<void>
  onExecuteAction: (actionId: string) => Promise<{ href?: string }>
  onDismiss: () => Promise<void>
  t: (key: string, fallback?: string) => string
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
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
}: NotificationItemProps) {
  const router = useRouter()
  const [executing, setExecuting] = React.useState<string | null>(null)

  const isUnread = notification.status === 'unread'
  const hasActions = notification.actions && notification.actions.length > 0
  const severity = notification.severity as keyof typeof severityIcons
  const IconComponent = severityIcons[severity] ?? Bell

  const handleClick = async () => {
    if (isUnread) {
      await onMarkAsRead()
    }
    if (notification.linkHref) {
      router.push(notification.linkHref)
    }
  }

  const handleAction = async (actionId: string, event: React.MouseEvent) => {
    event.stopPropagation()
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

  const handleDismiss = async (event: React.MouseEvent) => {
    event.stopPropagation()
    await onDismiss()
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
              {notification.title}
            </h4>
            <span className="flex-shrink-0 text-xs text-muted-foreground">
              {formatTimeAgo(notification.createdAt)}
            </span>
          </div>

          {notification.body && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {notification.body}
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
                  {action.label}
                  {executing === action.id && (
                    <Loader2 className="ml-1 h-3 w-3 animate-spin" />
                  )}
                </Button>
              ))}
            </div>
          )}

          {notification.status === 'actioned' && notification.actionTaken && (
            <p className="mt-1 text-xs text-muted-foreground italic">
              {t('notifications.actionTaken', 'Action taken: {action}').replace(
                '{action}',
                notification.actionTaken
              )}
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
