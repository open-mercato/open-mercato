'use client'

import * as React from 'react'
import { addDays } from 'date-fns/addDays'
import { startOfDay } from 'date-fns/startOfDay'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { fetchScopedCalendarAppointments } from '@open-mercato/core/helpers/calendar/interactionCandidates'
import {
  AvailabilityRulesEditor,
  type AvailabilityRulesEditorProps,
} from '@open-mercato/core/modules/planner/components/AvailabilityRulesEditor'
import { buildMemberScheduleItems } from '../lib/memberSchedule'

type MemberAvailabilityRulesEditorProps = Omit<
  AvailabilityRulesEditorProps,
  'subjectType' | 'labelPrefix' | 'buildScheduleItems' | 'scheduleOverlay'
> & {
  memberUserId?: string | null
  memberOrganizationId?: string | null
}

type Overlay = NonNullable<AvailabilityRulesEditorProps['scheduleOverlay']>

export function MemberAvailabilityRulesEditor({
  memberUserId,
  memberOrganizationId,
  ...props
}: MemberAvailabilityRulesEditorProps) {
  const t = useT()
  const untitledEvent = t('schedule.item.kind.event', 'Event')
  const scopeVersion = useOrganizationScopeVersion()
  const scope = React.useMemo(() => ({
    userId: memberUserId,
    organizationId: memberOrganizationId,
    version: scopeVersion,
  }), [memberUserId, memberOrganizationId, scopeVersion])
  const loadOverlay = React.useCallback<Overlay['load']>(async (range, signal) => {
    if (!scope.userId || !scope.organizationId) return null
    const booked = await fetchScopedCalendarAppointments({
      userId: scope.userId,
      organizationId: scope.organizationId,
      from: startOfDay(range.start),
      to: addDays(startOfDay(range.end), 1),
      signal,
    })
    if (!booked) return null
    return {
      items: booked.items.map((item) => ({
        id: `calendar-appointment:${item.id}`,
        kind: 'event',
        title: item.title.trim() || untitledEvent,
        startsAt: item.start,
        endsAt: item.end,
        allDay: item.allDay,
      })),
      truncated: booked.truncated,
    }
  }, [scope, untitledEvent])
  const scheduleOverlay = memberUserId && memberOrganizationId ? {
    load: loadOverlay,
    labels: {
      loading: t('staff.teamMembers.schedule.bookings.loading', 'Loading calendar events…'),
      unavailable: t('staff.teamMembers.schedule.bookings.unavailable', 'Calendar events are unavailable.'),
      partial: t('staff.teamMembers.schedule.bookings.partial', 'Some calendar events are not shown.'),
    },
  } : undefined

  return (
    <AvailabilityRulesEditor
      {...props}
      subjectType="member"
      labelPrefix="staff.teamMembers"
      buildScheduleItems={buildMemberScheduleItems}
      scheduleOverlay={scheduleOverlay}
    />
  )
}
