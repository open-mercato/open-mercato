'use client'

import * as React from 'react'
import { fetchScopedCalendarAppointments } from '@open-mercato/core/helpers/calendar/interactionCandidates'
import { resolveTimeZone } from '@open-mercato/core/modules/planner/lib/availabilityTimezone'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { resolveStaffLeaveRange } from '../lib/availabilityWindows'

type LeaveScheduledEventsProps = {
  userId: string
  organizationId: string
  startDate: string
  endDate: string
  timezone: string | null
}

type CalendarAppointmentFeed = Awaited<ReturnType<typeof fetchScopedCalendarAppointments>>

export function LeaveScheduledEvents({ userId, organizationId, startDate, endDate, timezone }: LeaveScheduledEventsProps) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const timeZone = resolveTimeZone(timezone)
  const range = React.useMemo(
    () => resolveStaffLeaveRange(new Date(startDate), new Date(endDate), timeZone),
    [startDate, endDate, timeZone],
  )
  const requestKey = range
    ? JSON.stringify([userId, organizationId, range.start, range.end, scopeVersion])
    : null
  const [result, setResult] = React.useState<{ requestKey: string; feed: CalendarAppointmentFeed }>()
  const formatter = React.useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium', timeStyle: 'short', timeZone,
  }), [locale, timeZone])

  React.useEffect(() => {
    if (!requestKey || !range) return
    const controller = new AbortController()
    const finish = (feed: CalendarAppointmentFeed) => {
      if (!controller.signal.aborted) setResult({ requestKey, feed })
    }
    void fetchScopedCalendarAppointments({
      userId, organizationId, from: range.start, to: range.end, signal: controller.signal,
    }).then(finish, () => finish(null))
    return () => controller.abort()
  }, [requestKey, range, userId, organizationId])

  if (!requestKey) return null

  const feed = result?.requestKey === requestKey ? result.feed : undefined
  const title = t('staff.leaveRequests.schedule.title', 'Scheduled events')
  const count = feed?.items.length ?? 0

  return (
    <section aria-label={title} className="mb-6 space-y-2 rounded-lg border bg-card p-4">
      <SectionHeader title={title} />
      {feed === undefined ? (
        <LoadingMessage label={t('staff.leaveRequests.schedule.loading', 'Checking scheduled events…')} />
      ) : feed === null ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t('staff.leaveRequests.schedule.unavailable', 'Scheduled events are unavailable.')}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            {feed.truncated
              ? t('staff.leaveRequests.schedule.partial', 'Showing {count}. More events may overlap these dates.', { count })
              : count === 0
                ? t('staff.leaveRequests.schedule.empty', 'No scheduled events overlap these dates.')
                : count === 1
                  ? t('staff.leaveRequests.schedule.one', '1 scheduled event')
                  : t('staff.leaveRequests.schedule.many', '{count} scheduled events', { count })}
          </p>
          {count > 0 ? (
            <ul className="divide-y divide-border">
              {feed.items.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                  <span className="min-w-0 break-words font-medium">
                    {event.title || t('staff.leaveRequests.schedule.untitled', 'Untitled event')}
                  </span>
                  <span className="text-muted-foreground">
                    {formatter.formatRange(event.start, event.end)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  )
}
