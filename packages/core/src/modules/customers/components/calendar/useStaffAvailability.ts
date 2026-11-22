'use client'

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { CalendarRange } from './types'
import {
  EMPTY_STAFF_AVAILABILITY,
  loadStaffAvailability,
  staffAvailabilityUserIds,
  type StaffAvailability,
} from '../../lib/calendar/staffAvailability'

export function useStaffAvailability({
  userIds,
  range,
  organizationId = null,
  debounceMs = 0,
}: {
  userIds: readonly string[]
  range: CalendarRange | null
  organizationId?: string | null
  debounceMs?: number
}): StaffAvailability {
  const scopeVersion = useOrganizationScopeVersion()
  const requestedIds = staffAvailabilityUserIds(userIds).join(',')
  const from = range?.from.getTime()
  const to = range?.to.getTime()
  const requestKey = requestedIds && from !== undefined && to !== undefined && from < to
    ? JSON.stringify([requestedIds, from, to, organizationId, scopeVersion])
    : null
  const [result, setResult] = React.useState<{ requestKey: string; availability: StaffAvailability }>()

  React.useEffect(() => {
    if (!requestKey || from === undefined || to === undefined) return
    const controller = new AbortController()
    const fetchWindows = () => {
      void loadStaffAvailability(requestedIds.split(','), from, to, organizationId, controller.signal).then((availability) => {
        if (!controller.signal.aborted) setResult({ requestKey, availability })
      })
    }
    const timer = debounceMs ? window.setTimeout(fetchWindows, debounceMs) : null
    if (timer === null) fetchWindows()
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      controller.abort()
    }
  }, [requestKey, from, to, organizationId, requestedIds, debounceMs])
  return result?.requestKey === requestKey ? result.availability : EMPTY_STAFF_AVAILABILITY
}
