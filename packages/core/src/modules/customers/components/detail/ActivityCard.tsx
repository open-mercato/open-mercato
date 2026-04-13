'use client'

import * as React from 'react'
import { Calendar, ExternalLink, Mail, MoreHorizontal, Phone, StickyNote, Users } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { InteractionSummary } from './types'
import { ActivityAiActions } from './ActivityAiActions'
import { getInitials } from './utils'

type ActivityCardProps = {
  activity: InteractionSummary
  onOpen?: (activity: InteractionSummary) => void
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
}

function formatDayLabel(value: string, t: ReturnType<typeof useT>): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((today - day) / 86400000)
  if (diffDays === 0) return t('customers.timeline.date.today', 'today')
  if (diffDays === 1) return t('customers.timeline.date.yesterday', 'yesterday')
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function formatTimeLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function trimSnippet(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  if (normalized.length <= 200) return normalized
  return `${normalized.slice(0, 197)}...`
}

function resolveTarget(activity: InteractionSummary): string | null {
  const participant = activity.participants?.find((item) => item.name || item.email)
  if (participant?.name) return participant.name
  if (participant?.email) return participant.email
  if (activity.customer?.displayName) return activity.customer.displayName
  return null
}

export function ActivityCard({ activity, onOpen }: ActivityCardProps) {
  const t = useT()
  const timestamp = activity.occurredAt ?? activity.scheduledAt ?? activity.createdAt
  const TypeIcon = TYPE_ICONS[activity.interactionType] ?? StickyNote
  const titleBase = activity.title ?? activity.body ?? activity.interactionType
  const title = activity.duration ? `${titleBase} (${activity.duration} min)` : titleBase
  const snippet = trimSnippet(activity.body && activity.title ? activity.body : activity.body ?? null)
  const actorLabel = activity.authorName ?? activity.authorEmail ?? t('customers.changelog.user.system', 'System')
  const target = resolveTarget(activity)
  const direction = activity.interactionType === 'email'
    ? t('customers.activityLog.direction.to', 'to')
    : activity.interactionType === 'call' || activity.interactionType === 'meeting'
      ? t('customers.activityLog.direction.with', 'with')
      : ''
  const showExternalLink = Boolean(activity._integrations && Object.keys(activity._integrations).length > 0)

  return (
    <div
      className={cn(
        'grid gap-3',
        onOpen ? 'cursor-pointer' : '',
      )}
      style={{ gridTemplateColumns: '64px 36px minmax(0,1fr)' }}
      onClick={() => onOpen?.(activity)}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(activity)
        }
      } : undefined}
    >
      <div className="pt-1 text-xs text-muted-foreground">
        <div className="font-semibold text-foreground">{formatDayLabel(timestamp, t)}</div>
        <div>{formatTimeLabel(timestamp)}</div>
      </div>

      <div className="flex size-9 items-center justify-center rounded-lg bg-muted/80">
        <TypeIcon className="size-4 text-muted-foreground" />
      </div>

      <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-sm font-semibold text-foreground">{title}</h4>
              {showExternalLink ? <ExternalLink className="size-3.5 text-muted-foreground" /> : null}
            </div>
            {activity.location ? (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="size-3.5" />
                <span className="truncate">{activity.location}</span>
              </div>
            ) : null}
          </div>

          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('customers.timeline.more', 'More')}
            onClick={(event) => {
              event.stopPropagation()
              onOpen?.(activity)
            }}
          >
            <MoreHorizontal className="size-4" />
          </IconButton>
        </div>

        <div className="mt-2">
          <ActivityAiActions activityType={activity.interactionType} />
        </div>

        {snippet ? (
          <p className="mt-2 text-sm text-muted-foreground">{snippet}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
            {getInitials(actorLabel)}
          </span>
          <span className="font-medium text-foreground">{actorLabel}</span>
          {target && direction ? (
            <>
              <span>·</span>
              <span>{direction}</span>
              <span className="text-foreground">{target}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default ActivityCard
