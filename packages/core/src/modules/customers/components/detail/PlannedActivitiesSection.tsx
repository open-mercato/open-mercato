'use client'
import * as React from 'react'
import { Clock, AlertCircle, CalendarClock } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InteractionSummary } from './types'

interface PlannedActivitiesSectionProps {
  activities: InteractionSummary[]
  onComplete?: (id: string) => void
}

export function PlannedActivitiesSection({ activities, onComplete }: PlannedActivitiesSectionProps) {
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
    <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CalendarClock className="size-4 text-muted-foreground" />
        {t('customers.timeline.planned.title', 'Planned activities')}
      </div>

      {overdue.map((activity) => (
        <div
          key={activity.id}
          className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm"
        >
          <AlertCircle className="size-4 text-destructive mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-destructive">
                {t('customers.timeline.planned.overdue', 'Overdue')}
              </span>
              <span className="text-xs text-muted-foreground">
                {activity.scheduledAt ? formatDate(activity.scheduledAt) : ''}
              </span>
            </div>
            <span className="text-sm truncate block">
              {activity.title ?? activity.body ?? activity.interactionType}
            </span>
          </div>
        </div>
      ))}

      {upcoming.map((activity) => (
        <div
          key={activity.id}
          className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <Clock className="size-4 text-green-600 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-green-600">
                {t('customers.timeline.planned.upcoming', 'Upcoming')}
              </span>
              <span className="text-xs text-muted-foreground">
                {activity.scheduledAt ? formatDate(activity.scheduledAt) : ''}
              </span>
            </div>
            <span className="text-sm truncate block">
              {activity.title ?? activity.body ?? activity.interactionType}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return isoString
  }
}
