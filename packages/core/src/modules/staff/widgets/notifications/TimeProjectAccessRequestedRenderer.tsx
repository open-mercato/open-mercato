'use client'

import * as React from 'react'
import { Loader2, UserPlus, Users, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'

export function TimeProjectAccessRequestedRenderer({
  notification,
  onAction,
  onDismiss,
  actions = [],
}: NotificationRendererProps) {
  const t = useT()
  const router = useRouter()
  const [executing, setExecuting] = React.useState(false)
  const isUnread = notification.status === 'unread'
  const projectName = notification.bodyVariables?.projectName
  const openAction = actions.find((action) => action.id === 'open-team') ?? actions[0] ?? null

  const handleOpen = React.useCallback(async () => {
    setExecuting(true)
    try {
      if (openAction) {
        try {
          await onAction(openAction.id)
        } catch {
          // A notification already actioned by another manager must still open.
        }
      }
      if (notification.linkHref) router.push(notification.linkHref)
    } finally {
      setExecuting(false)
    }
  }, [notification.linkHref, onAction, openAction, router])

  const timeAgo = formatRelativeTime(notification.createdAt, { translate: t }) ?? ''
  const scopeLabel = projectName
    ? `${t('staff.notifications.timeProjectAccess.renderer.project', 'Project')}: ${projectName}`
    : t('staff.notifications.timeProjectAccess.renderer.generalRequest', 'No project selected')

  return (
    <div
      className={cn(
        'group relative flex gap-4 items-start rounded-xl p-3 transition-colors hover:bg-muted/40 cursor-pointer',
        isUnread && 'bg-muted/20',
      )}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleOpen()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="relative shrink-0 flex size-10 items-center justify-center rounded-full bg-status-info-bg">
        <UserPlus className="size-5 text-status-info-icon" aria-hidden="true" />
        {isUnread ? (
          <span
            className="absolute -right-1 -top-1 size-3 rounded-full bg-status-info-icon ring-2 ring-background"
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-medium leading-5 tracking-tight text-foreground">
          {notification.title}
        </p>
        {notification.body ? (
          <p className="text-xs leading-4 text-muted-foreground">{notification.body}</p>
        ) : null}

        <div className="text-xs leading-4 text-muted-foreground">
          {timeAgo ? (
            <>
              <span className="whitespace-nowrap">{timeAgo}</span>
              <span aria-hidden="true" className="mx-1 text-text-disabled">·</span>
            </>
          ) : null}
          <span className="truncate">{scopeLabel}</span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              handleOpen()
            }}
            disabled={executing || !notification.linkHref}
          >
            <Users className="size-3.5" aria-hidden="true" />
            {t('staff.notifications.timeProjectAccess.actions.openTeam', 'Open project team')}
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

export default TimeProjectAccessRequestedRenderer
