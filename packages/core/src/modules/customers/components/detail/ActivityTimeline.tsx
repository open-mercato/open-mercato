'use client'
import * as React from 'react'
import { Phone, Mail, Users, StickyNote, User } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { AiActionChips } from './AiActionChips'
import type { InteractionSummary } from './types'

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
}

interface ActivityTimelineProps {
  activities: InteractionSummary[]
  onEdit?: (activity: InteractionSummary) => void
}

export function ActivityTimeline({ activities, onEdit }: ActivityTimelineProps) {
  const t = useT()

  if (activities.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        {t('customers.timeline.empty', 'No activities match the current filters.')}
      </div>
    )
  }

  return (
    <div>
      {activities.map((activity, index) => {
        const dateStr = activity.scheduledAt ?? activity.occurredAt ?? activity.createdAt
        const activityYear = dateStr ? new Date(dateStr).getFullYear() : null
        const prevDateStr = index > 0 ? (activities[index - 1].scheduledAt ?? activities[index - 1].occurredAt ?? activities[index - 1].createdAt) : null
        const prevYear = prevDateStr ? new Date(prevDateStr).getFullYear() : null
        const showYearSeparator = activityYear !== null && prevYear !== null && activityYear !== prevYear

        return (
          <React.Fragment key={activity.id}>
            {showYearSeparator && (
              <div className="flex items-center gap-3 py-3 px-5">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-semibold text-muted-foreground">
                  {t('customers.activities.yearSeparator', '{year}', { year: activityYear })}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            <TimelineEntry
              activity={activity}
              t={t}
              withBorder={index < activities.length - 1}
              onEdit={onEdit}
            />
          </React.Fragment>
        )
      })}
    </div>
  )
}

function TimelineEntry({
  activity,
  t,
  withBorder,
  onEdit,
}: {
  activity: InteractionSummary
  t: TranslateFn
  withBorder: boolean
  onEdit?: (activity: InteractionSummary) => void
}) {
  const dateStr = activity.scheduledAt ?? activity.occurredAt ?? activity.createdAt
  const TypeIcon = TYPE_ICONS[activity.interactionType]
  const title = activity.title ?? activity.body ?? activity.interactionType
  const duration = activity.duration ? ` (${activity.duration} min)` : ''

  return (
    <div
      className={`py-2.5 ${withBorder ? 'border-b border-border/60' : ''} ${onEdit ? 'cursor-pointer hover:bg-accent/40 transition-colors' : ''}`}
      onClick={() => onEdit?.(activity)}
      role={onEdit ? 'button' : undefined}
      tabIndex={onEdit ? 0 : undefined}
      onKeyDown={onEdit ? (e) => { if (e.key === 'Enter') onEdit(activity) } : undefined}
    >
      <div className="grid items-start gap-3" style={{ gridTemplateColumns: '75px 32px 1fr' }}>
        {/* Column 1: Date */}
        <div className="shrink-0">
          <span className="block text-[11px] font-semibold leading-tight text-foreground">
            {formatRelativeDate(dateStr, t)}
          </span>
          <span className="block text-[10px] leading-tight text-muted-foreground">
            {formatTime(dateStr)}
          </span>
        </div>

        {/* Column 2: Type icon */}
        <div className="flex size-8 items-center justify-center rounded-md bg-muted shrink-0">
          {TypeIcon ? <TypeIcon className="size-3.5 text-muted-foreground" /> : null}
        </div>

        {/* Column 3: Content */}
        <div className="min-w-0 space-y-1.5">
          <span className="block text-[12px] font-semibold leading-tight text-foreground">
            {title}{duration}
          </span>

          {activity.body && activity.title && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {activity.body}
            </p>
          )}

          {activity.authorName && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <User className="size-2.5 shrink-0" />
              <span>{t('customers.timeline.author', 'by {{name}}', { name: activity.authorName })}</span>
            </div>
          )}

          <AiActionChips activityType={activity.interactionType} />
        </div>
      </div>
    </div>
  )
}

function formatRelativeDate(isoString: string, t: TranslateFn): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    // Compare calendar dates (not time-based diff) to correctly handle same-day future times
    const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const diffDays = Math.round((nowDay.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return t('customers.timeline.date.today', 'today')
    if (diffDays === 1) return t('customers.timeline.date.yesterday', 'yesterday')
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

function formatTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
