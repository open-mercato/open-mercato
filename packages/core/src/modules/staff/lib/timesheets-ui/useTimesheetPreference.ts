"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

export type TimesheetPreference = {
  lastProjectId: string | null
  updatedAt: string | null
}

type TimesheetPreferenceResult = TimesheetPreference & {
  isLoading: boolean
  isFetching: boolean
  error: Error | null
  save: (lastProjectId: string | null) => Promise<void>
}

const EMPTY_PREFERENCE: TimesheetPreference = { lastProjectId: null, updatedAt: null }

/**
 * Keyed by staff member id, which is inherently organization-discriminating:
 * `StaffTeamMember` is org-scoped, so one user acting in two organizations has two
 * member rows and therefore two ids. A scope-blind key would let an org-A
 * preference be served from cache in org B.
 */
export const timesheetPreferenceQueryKey = (staffMemberId: string) =>
  ['staff', 'timesheets', 'preference', staffMemberId] as const

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// The endpoint is self-scoped and takes no member parameter; the id exists only
// to key the cache entry.
async function fetchTimesheetPreference(): Promise<TimesheetPreference> {
  const res = await apiCall<{ lastProjectId?: unknown; updatedAt?: unknown }>(
    '/api/staff/timesheets/my-preferences',
  )
  if (!res.ok) {
    // The status has to ride along: the app's shared `shouldRetryQuery` reads it to
    // skip retries on 400-404. A bare Error hides it, so a 403 ("no staff member
    // linked") would be retried twice with backoff — and the seed effects block on
    // `isLoading` for that whole window rather than settling on the honest empty state.
    throw Object.assign(new Error('[internal] Failed to load timesheet preference.'), {
      status: res.status,
    })
  }
  return {
    lastProjectId: getString(res.result?.lastProjectId),
    updatedAt: getString(res.result?.updatedAt),
  }
}

export const timesheetPreferenceQueryOptions = (staffMemberId: string) => ({
  queryKey: timesheetPreferenceQueryKey(staffMemberId),
  queryFn: fetchTimesheetPreference,
})

/**
 * Persists the caller's last-started project.
 *
 * Deliberately outside `useGuardedMutation`: this is a non-user-initiated side
 * effect of a timer start that already succeeded. It must never fail the start or
 * surface an error, so callers should not await it in a way that can reject —
 * failures are swallowed and self-heal on the next successful start. The route
 * itself still runs the full server-side mutation-guard registry.
 */
export async function saveTimesheetPreference(
  queryClient: QueryClient,
  staffMemberId: string,
  lastProjectId: string | null,
): Promise<void> {
  const res = await apiCall('/api/staff/timesheets/my-preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastProjectId }),
  })
  if (!res.ok) {
    // Callers swallow this into a `logger.warn`, so the status is the only thing
    // that distinguishes a rejected project (400) from an outage (500) in the logs.
    throw Object.assign(new Error('[internal] Failed to save timesheet preference.'), {
      status: res.status,
    })
  }
  await queryClient.invalidateQueries({ queryKey: timesheetPreferenceQueryKey(staffMemberId) })
}

export function useTimesheetPreference(staffMemberId: string | null): TimesheetPreferenceResult {
  const queryClient = useQueryClient()
  const query = useQuery({
    ...timesheetPreferenceQueryOptions(staffMemberId ?? ''),
    // No unkeyed or placeholder-keyed fetch: without a member id there is no
    // scope to key the cache entry by.
    enabled: Boolean(staffMemberId),
  })
  const data = query.data ?? EMPTY_PREFERENCE

  // Stable identity so callers can list it in a `useCallback` dependency array
  // without re-creating their handler on every render.
  const save = React.useCallback(
    async (lastProjectId: string | null) => {
      if (!staffMemberId) return
      await saveTimesheetPreference(queryClient, staffMemberId, lastProjectId)
    },
    [queryClient, staffMemberId],
  )

  return {
    ...data,
    // A disabled query never resolves, so treat "no member yet" as still loading
    // rather than as a settled empty preference the seed effect could act on.
    isLoading: staffMemberId ? query.isLoading : true,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error : null,
    save,
  }
}
