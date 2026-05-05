'use client'

import * as React from 'react'
import { Calendar, CalendarClock, Clock, Mail, Phone, StickyNote, Users } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { ActivitiesDayStrip } from './ActivitiesDayStrip'
import { ActivitiesAddNewMenu, type ActivityKind } from './ActivitiesAddNewMenu'
import type { InteractionSummary } from './types'

interface ActivitiesCardProps {
  entityId: string
  plannedActivities: InteractionSummary[]
  refreshKey?: number
  onAddNew: (kind: ActivityKind) => void
  onEditActivity?: (activity: InteractionSummary) => void
  /**
   * Optional company name for the parent entity. When the planned activity has no `dealTitle`,
   * the row subtitle falls back to "{type} · {company}" to mirror Figma 784:809.
   */
  entityCompanyName?: string | null
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: StickyNote,
}

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isOverdue(activity: InteractionSummary, now: Date): boolean {
  const scheduled = activity.scheduledAt ?? activity.occurredAt
  if (!scheduled) return false
  const date = new Date(scheduled)
  if (Number.isNaN(date.getTime())) return false
  return date.getTime() < now.getTime() && activity.status !== 'done'
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatRelativeDay(date: Date, t: TranslateFn): string {
  const now = new Date()
  const today = startOfDay(now)
  const target = startOfDay(date)
  const diff = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return t('customers.timeline.date.today', 'today')
  if (diff === 1) return t('customers.timeline.date.tomorrow', 'tomorrow')
  if (diff === -1) return t('customers.timeline.date.yesterday', 'yesterday')
  return target.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function formatDuration(minutes: number, t: TranslateFn): string {
  if (minutes >= 60) {
    const hours = Math.round((minutes / 60) * 10) / 10
    return t('customers.activities.calendar.hoursShort', '{hours}h', { hours })
  }
  return t('customers.activities.calendar.minutesShort', '{minutes}m', { minutes })
}

export function ActivitiesCard({
  entityId,
  plannedActivities,
  refreshKey = 0,
  onAddNew,
  onEditActivity,
  entityCompanyName,
}: ActivitiesCardProps) {
  const t = useT()
  const [selectedDate, setSelectedDate] = React.useState<Date>(() => startOfDay(new Date()))

  const eventsForSelectedDay = React.useMemo(() => {
    const items = plannedActivities.filter((activity) => {
      const scheduled = activity.scheduledAt ?? activity.occurredAt
      if (!scheduled) return false
      const date = new Date(scheduled)
      if (Number.isNaN(date.getTime())) return false
      return isSameDay(date, selectedDate)
    })
    return items.sort((left, right) => {
      const leftTime = new Date(left.scheduledAt ?? left.occurredAt ?? left.createdAt).getTime()
      const rightTime = new Date(right.scheduledAt ?? right.occurredAt ?? right.createdAt).getTime()
      return leftTime - rightTime
    })
  }, [plannedActivities, selectedDate])

  const overdueCount = React.useMemo(() => {
    const now = new Date()
    return plannedActivities.filter((activity) => isOverdue(activity, now)).length
  }, [plannedActivities])

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card pt-4 pb-4 px-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="size-4 text-foreground" />
          <h3 className="text-sm font-semibold leading-none text-foreground">
            {t('customers.activities.card.title', 'Activities')}
          </h3>
          {overdueCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-status-error-bg px-1.5 py-0.5 text-xs font-medium text-status-error-text">
              <CalendarClock className="size-3" />
              {t('customers.activities.card.overdue', '{count} overdue', { count: overdueCount })}
            </span>
          ) : null}
        </div>
        <ActivitiesAddNewMenu onSelect={onAddNew} />
      </div>

      <ActivitiesDayStrip
        entityId={entityId}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        refreshKey={refreshKey}
      />

      {eventsForSelectedDay.length > 0 ? (
        <>
          <div className="h-px w-full bg-border" />
          <ul className="flex flex-col">
            {eventsForSelectedDay.map((activity) => (
              <PlannedEventRow
                key={activity.id}
                activity={activity}
                onClick={onEditActivity}
                entityCompanyName={entityCompanyName ?? null}
                t={t}
              />
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="h-px w-full bg-border" />
          <p className="px-1 py-2 text-xs text-muted-foreground">
            {t('customers.activities.card.empty', 'Nothing scheduled for this day.')}
          </p>
        </>
      )}
    </div>
  )
}

interface PlannedEventRowProps {
  activity: InteractionSummary
  onClick?: (activity: InteractionSummary) => void
  entityCompanyName: string | null
  t: TranslateFn
}

function PlannedEventRow({ activity, onClick, entityCompanyName, t }: PlannedEventRowProps) {
  const dateStr = activity.scheduledAt ?? activity.occurredAt ?? activity.createdAt
  const date = new Date(dateStr)
  const validDate = !Number.isNaN(date.getTime())
  const Icon = TYPE_ICONS[activity.interactionType] ?? Users
  const duration = typeof activity.duration === 'number' && activity.duration > 0 ? activity.duration : null
  const overdue = validDate && date.getTime() < Date.now() && activity.status !== 'done'
  const typeLabel = labelForType(activity.interactionType, t)
  const subtitleSuffix = activity.dealTitle ?? entityCompanyName ?? null
  const subtitle = subtitleSuffix ? `${typeLabel} · ${subtitleSuffix}` : typeLabel
  const interactive = !!onClick

  return (
    <li>
      <button
        type="button"
        onClick={interactive ? () => onClick?.(activity) : undefined}
        disabled={!interactive}
        className={cn(
          'flex w-full items-start gap-[9px] pt-[8px] text-left transition-colors',
          interactive ? 'cursor-pointer rounded-md hover:bg-accent/30 px-1' : 'px-1',
        )}
      >
        <div className="flex h-[44px] w-[43px] shrink-0 flex-col gap-[2px] pt-[2px]">
          <span className="text-xs font-semibold leading-none text-foreground">
            {validDate ? formatTime(date) : ''}
          </span>
          <span className="text-[10px] leading-none font-normal text-muted-foreground">
            {validDate ? formatRelativeDay(date, t) : ''}
          </span>
        </div>
        <div className="flex shrink-0 items-center justify-center rounded-full bg-muted border-4 border-background size-7">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex flex-1 flex-col gap-[4px]">
          <span className="text-sm leading-5 tracking-[-0.084px] text-foreground">
            {activity.title ?? activity.body ?? labelForType(activity.interactionType, t)}
          </span>
          {duration ? (
            <span className={cn(
              'inline-flex w-fit items-center gap-[2px] rounded-full pl-[4px] pr-[8px] py-[2px] text-xs font-medium leading-[16px]',
              overdue
                ? 'bg-status-error-bg text-status-error-text'
                : 'bg-status-warning-bg text-status-warning-text',
            )}>
              <Clock className="size-4" />
              {formatDuration(duration, t)}
            </span>
          ) : null}
          <span className="text-[11px] font-normal text-muted-foreground">{subtitle}</span>
        </div>
      </button>
    </li>
  )
}

function labelForType(type: string, t: TranslateFn): string {
  const map: Record<string, [string, string]> = {
    meeting: ['customers.timeline.filter.meeting', 'Meeting'],
    call: ['customers.timeline.filter.call', 'Call'],
    email: ['customers.timeline.filter.email', 'Email'],
    note: ['customers.timeline.filter.note', 'Note'],
    task: ['customers.timeline.filter.task', 'Task'],
  }
  const entry = map[type]
  return entry ? t(entry[0], entry[1]) : type
}

export default ActivitiesCard
