'use client'
import * as React from 'react'
import { Phone, Mail, Users, StickyNote, Clock, AlertCircle, CalendarClock, Check, MoreHorizontal, Plus } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import type { InteractionSummary } from './types'

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
}

interface PlannedActivitiesSectionProps {
  activities: InteractionSummary[]
  onComplete?: (id: string) => void
  onSchedule?: () => void
  onEdit?: (activity: InteractionSummary) => void
  onCancel?: (id: string) => void
}

export function PlannedActivitiesSection({ activities, onComplete, onSchedule, onEdit, onCancel }: PlannedActivitiesSectionProps) {
  const t = useT()

  if (activities.length === 0) return null

  const now = new Date()

  const classified = activities.map((activity) => {
    const scheduledDate = activity.scheduledAt ? new Date(activity.scheduledAt) : null
    const isOverdue = scheduledDate ? scheduledDate < now : false
    return { ...activity, isOverdue }
  })

  const overdue = classified.filter((a) => a.isOverdue)
  const upcoming = classified.filter((a) => !a.isOverdue)

  return (
    <div className="rounded-lg border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="size-4 text-muted-foreground" />
          {t('customers.timeline.planned.title', 'Planned activities')}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            {activities.length}
          </span>
          {overdue.length > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-destructive">
              <AlertCircle className="size-3" />
              {overdue.length} {t('customers.timeline.planned.overdueCount', 'overdue')}
            </span>
          )}
        </div>
        {onSchedule && (
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onSchedule}>
            <Plus className="mr-1 size-3" />
            {t('customers.timeline.planned.schedule', 'Schedule')}
          </Button>
        )}
      </div>

      {/* Items */}
      <div className="divide-y">
        {overdue.map((activity) => {
          const TypeIcon = TYPE_ICONS[activity.interactionType]
          return (
            <div
              key={activity.id}
              className="flex items-center gap-3 border-l-2 border-l-destructive px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => onEdit?.(activity)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onEdit?.(activity) }}
            >
              <div className="flex items-center justify-center size-8 rounded-full bg-destructive/10 shrink-0">
                {TypeIcon ? <TypeIcon className="size-4 text-destructive" /> : <AlertCircle className="size-4 text-destructive" />}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium block truncate">
                  {activity.title ?? activity.body ?? activity.interactionType}
                </span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 font-medium text-destructive">
                    {t('customers.timeline.planned.overdue', 'Overdue')}
                  </span>
                  <span>
                    {activity.scheduledAt ? formatRelativeOverdue(activity.scheduledAt, t) : ''}
                  </span>
                  {activity.authorName && (
                    <>
                      <span>·</span>
                      <span>{activity.authorName}</span>
                    </>
                  )}
                </div>
              </div>
              {onComplete && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  onClick={(event) => {
                    event.stopPropagation()
                    onComplete(activity.id)
                  }}
                >
                  <Check className="mr-1 size-3" />
                  {t('customers.timeline.planned.markDone', 'Mark done')}
                </Button>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <IconButton type="button" variant="ghost" size="xs" aria-label={t('customers.timeline.more', 'More')} onClick={(e) => e.stopPropagation()}>
                    <MoreHorizontal className="size-3.5" />
                  </IconButton>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-40 p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-xs"
                    onClick={(event) => {
                      event.stopPropagation()
                      onEdit?.(activity)
                    }}
                  >
                    {t('customers.timeline.planned.reschedule', 'Reschedule')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-xs text-destructive hover:text-destructive"
                    onClick={(event) => {
                      event.stopPropagation()
                      onCancel?.(activity.id)
                    }}
                  >
                    {t('customers.timeline.planned.cancel', 'Cancel')}
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
          )
        })}

        {upcoming.map((activity) => {
          const TypeIcon = TYPE_ICONS[activity.interactionType]
          return (
            <div
              key={activity.id}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => onEdit?.(activity)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onEdit?.(activity) }}
            >
              <div className="flex items-center justify-center size-8 rounded-full bg-muted shrink-0">
                {TypeIcon ? <TypeIcon className="size-4 text-muted-foreground" /> : <Clock className="size-4 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium block truncate">
                  {activity.title ?? activity.body ?? activity.interactionType}
                </span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{activity.scheduledAt ? formatScheduledDate(activity.scheduledAt) : ''}</span>
                  {activity.authorName && (
                    <>
                      <span>·</span>
                      <span>{activity.authorName}</span>
                    </>
                  )}
                </div>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <IconButton type="button" variant="ghost" size="xs" aria-label={t('customers.timeline.more', 'More')} onClick={(e) => e.stopPropagation()}>
                    <MoreHorizontal className="size-3.5" />
                  </IconButton>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-40 p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-xs"
                    onClick={(event) => {
                      event.stopPropagation()
                      onEdit?.(activity)
                    }}
                  >
                    {t('customers.timeline.planned.reschedule', 'Reschedule')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-xs text-destructive hover:text-destructive"
                    onClick={(event) => {
                      event.stopPropagation()
                      onCancel?.(activity.id)
                    }}
                  >
                    {t('customers.timeline.planned.cancel', 'Cancel')}
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatRelativeOverdue(isoString: string, t: TranslateFn): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays <= 0) return t('customers.timeline.planned.overdueToday', 'due today')
    if (diffDays === 1) return t('customers.timeline.planned.overdueSince', 'since yesterday')
    return t('customers.timeline.planned.overdueDays', 'overdue {{days}} days', { days: diffDays })
  } catch {
    return ''
  }
}

function formatScheduledDate(isoString: string): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const dayName = date.toLocaleDateString(undefined, { weekday: 'short' })
    const dateStr = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

    if (date.toDateString() === tomorrow.toDateString()) {
      return `Tomorrow ${timeStr}`
    }
    return `${dayName}, ${dateStr} · ${timeStr}`
  } catch {
    return isoString
  }
}
