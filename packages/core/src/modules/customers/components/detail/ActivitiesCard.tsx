'use client'

import * as React from 'react'
import { Calendar, CalendarClock, Clock, Mail, Phone, StickyNote, Users } from 'lucide-react'
import { toZonedTime } from 'date-fns-tz'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ActivitiesDayStrip } from './ActivitiesDayStrip'
import { ActivitiesAddNewMenu, type ActivityKind } from './ActivitiesAddNewMenu'
import type { InteractionSummary } from './types'

interface ActivitiesCardProps {
  entityId: string
  /**
   * Initial planned activities (from the parent route's `plannedActivitiesPreview`).
   * Used as the seed value before the broader `/api/customers/interactions` fetch
   * resolves, and as the fallback when the fetch fails. The card always prefers
   * its own fetched window (issue #1809 — fixes E1 status alignment and E2 type
   * coverage by sourcing from the same endpoint as the day strip rather than the
   * 5-item server preview that excluded most types in practice).
   */
  plannedActivities: InteractionSummary[]
  refreshKey?: number
  onAddNew: (kind: ActivityKind, selectedDate?: Date) => void
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

const USER_TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

// Project a UTC instant to the user's local timezone before extracting day/month/year
// for "same day" comparisons (issue #1809 — E3 timezone drift).
function toLocalZonedDate(value: string | Date): Date {
  return toZonedTime(value, USER_TIMEZONE)
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

// Visible window for the day-strip + activity list. Mirrors `VISIBLE_DAYS = 5`
// in ActivitiesDayStrip with extra padding so navigation forward/back doesn't
// race the fetch.
const FETCH_WINDOW_DAYS = 31

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
  // Fetch the same broader window as the day strip via the canonical interactions
  // endpoint. This single source of truth aligns the day-strip count with the
  // visible event list (issue #1809 — E1) and surfaces all interaction types
  // (issue #1809 — E2: the previous reliance on the server-side 5-item preview
  // produced "Person view shows only Calls" because the limit happened to drop
  // every non-call entry from the prefix-window).
  const [fetchedEvents, setFetchedEvents] = React.useState<InteractionSummary[] | null>(null)

  React.useEffect(() => {
    if (!entityId) {
      setFetchedEvents(null)
      return
    }
    const controller = new AbortController()
    const today = startOfDay(new Date())
    const fromDate = new Date(today)
    fromDate.setDate(today.getDate() - FETCH_WINDOW_DAYS)
    const toDate = new Date(today)
    toDate.setDate(today.getDate() + FETCH_WINDOW_DAYS)
    toDate.setHours(23, 59, 59, 999)
    const params = new URLSearchParams({
      entityId,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      // Server caps at 100 (interactions querySchema). 100 is well above what
      // an active CRM record accumulates in a 31-day window of meetings/calls,
      // and the day strip + list naturally degrade to truncation if exceeded.
      limit: '100',
      sortField: 'scheduledAt',
      sortDir: 'asc',
      excludeInteractionType: 'task',
    })
    void (async () => {
      try {
        const payload = await readApiResultOrThrow<{ items?: InteractionSummary[] }>(
          `/api/customers/interactions?${params.toString()}`,
          { signal: controller.signal },
        )
        setFetchedEvents(Array.isArray(payload?.items) ? payload.items : [])
      } catch (err) {
        if ((err as { name?: string } | null)?.name !== 'AbortError') {
          console.warn('[ActivitiesCard] failed to load interactions', err)
          setFetchedEvents(null)
        }
      }
    })()
    return () => controller.abort()
  }, [entityId, refreshKey])

  // Prefer the broader fetch when it has resolved; fall back to the seed prop
  // (route-supplied preview) only while the fetch is in flight or after a
  // hard failure. This guarantees that the rare prop-only render path keeps
  // backwards-compat with existing unit tests while live UI uses the broader fetch.
  const effectiveEvents: InteractionSummary[] = fetchedEvents ?? plannedActivities

  const eventsForSelectedDay = React.useMemo(() => {
    const items = effectiveEvents.filter((activity) => {
      const scheduled = activity.scheduledAt ?? activity.occurredAt
      if (!scheduled) return false
      const date = new Date(scheduled)
      if (Number.isNaN(date.getTime())) return false
      // Compare in the user's local timezone so a 23:30 local activity stays
      // on its local-day chip instead of bleeding into the next UTC day
      // (issue #1809 — E3).
      return isSameDay(toLocalZonedDate(scheduled), selectedDate)
    })
    return items.sort((left, right) => {
      const leftTime = new Date(left.scheduledAt ?? left.occurredAt ?? left.createdAt).getTime()
      const rightTime = new Date(right.scheduledAt ?? right.occurredAt ?? right.createdAt).getTime()
      return leftTime - rightTime
    })
  }, [effectiveEvents, selectedDate])

  const overdueCount = React.useMemo(() => {
    const now = new Date()
    return effectiveEvents.filter((activity) => isOverdue(activity, now)).length
  }, [effectiveEvents])

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
        <ActivitiesAddNewMenu onSelect={(kind) => onAddNew(kind, selectedDate)} />
      </div>

      <ActivitiesDayStrip
        entityId={entityId}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        refreshKey={refreshKey}
        events={fetchedEvents ?? undefined}
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
