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
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
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
      {activities.map((activity, index) => (
        <TimelineEntry
          key={activity.id}
          activity={activity}
          t={t}
          withBorder={index < activities.length - 1}
        />
      ))}
    </div>
  )
}

function TimelineEntry({
  activity,
  t,
  withBorder,
}: {
  activity: InteractionSummary
  t: TranslateFn
  withBorder: boolean
}) {
  const dateStr = activity.scheduledAt ?? activity.occurredAt ?? activity.createdAt
  const TypeIcon = TYPE_ICONS[activity.interactionType]
  const title = activity.title ?? activity.body ?? activity.interactionType
  const duration = activity.duration ? ` (${activity.duration} min)` : ''

  return (
    <div className={`px-5 py-4 ${withBorder ? 'border-b border-border/60' : ''}`}>
      <div className="grid items-start gap-3" style={{ gridTemplateColumns: '72px 40px 1fr' }}>
        {/* Column 1: Date */}
        <div className="shrink-0 pt-0.5">
          <span className="block text-[12px] font-bold leading-tight">
            {formatRelativeDate(dateStr, t)}
          </span>
          <span className="block text-[12px] leading-tight text-muted-foreground">
            {formatTime(dateStr)}
          </span>
        </div>

        {/* Column 2: Type icon */}
        <div className="flex size-10 items-center justify-center rounded-[10px] bg-muted shrink-0">
          {TypeIcon ? <TypeIcon className="size-4 text-muted-foreground" /> : null}
        </div>

        {/* Column 3: Content */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold leading-5">
              {title}{duration}
            </span>
          </div>

          {activity.body && activity.title && (
            <p className="mt-1 text-sm text-muted-foreground">
              {activity.body}
            </p>
          )}

          {activity.authorName && (
            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <User className="size-3 shrink-0" />
              <span>{t('customers.timeline.author', 'by {{name}}', { name: activity.authorName })}</span>
            </div>
          )}

          <div className="mt-2">
            <AiActionChips activityType={activity.interactionType} />
          </div>
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
