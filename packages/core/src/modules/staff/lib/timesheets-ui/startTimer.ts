import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type StartTimerEntryInput = {
  staffMemberId: string
  timeProjectId: string
  date: string
  notes?: string | null
}

export type StartedTimerEntry = {
  id: string | null
}

/**
 * Starts a timesheet timer through the single atomic server endpoint
 * (`/api/staff/timesheets/time-entries/start-timer`), which creates the
 * timer-sourced entry AND starts it in one transaction. This replaces the
 * legacy create-then-start two-request sequence so a partial failure (a failed
 * second request, or the browser navigating between the two calls) can no
 * longer leave an orphaned, never-started timer entry (issue #3311). Both the
 * TimerBar and the dashboard time-reporting widget call this helper so they
 * share error handling and refresh semantics.
 */
export async function startTimerEntry(input: StartTimerEntryInput): Promise<StartedTimerEntry> {
  const response = await apiCallOrThrow<Record<string, unknown>>(
    '/api/staff/timesheets/time-entries/start-timer',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        staffMemberId: input.staffMemberId,
        timeProjectId: input.timeProjectId,
        date: input.date,
        notes: input.notes ?? null,
      }),
    },
  )
  const result = response.result as Record<string, unknown> | null
  return { id: (result?.id as string | undefined) ?? null }
}
