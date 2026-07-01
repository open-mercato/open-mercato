"use client"

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import * as React from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

export type ActiveTimesheetTimer = {
  staffMemberId: string | null
  entryId: string | null
  running: boolean
  startedAt: string | null
  projectId: string | null
  projectName: string | null
  projectColor: string | null
  notes: string | null
}

type ActiveTimesheetTimerResult = ActiveTimesheetTimer & {
  isLoading: boolean
  isFetching: boolean
  error: Error | null
  refresh: () => Promise<ActiveTimesheetTimer>
}

type ActiveTimesheetTimerOptions = {
  staffMemberId?: string | null
}

const ACTIVE_TIMER_REVALIDATE_MS = 30_000
const BASE_ACTIVE_TIMER_KEY = ['staff', 'timesheets', 'activeTimer'] as const

const EMPTY_ACTIVE_TIMER: ActiveTimesheetTimer = {
  staffMemberId: null,
  entryId: null,
  running: false,
  startedAt: null,
  projectId: null,
  projectName: null,
  projectColor: null,
  notes: null,
}

export const activeTimesheetTimerQueryKey = () => BASE_ACTIVE_TIMER_KEY

function getToday(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function getErrorMessage(result: unknown, fallback: string): string {
  if (result && typeof result === 'object') {
    const error = (result as Record<string, unknown>).error
    if (typeof error === 'string' && error.length > 0) return error
  }
  return fallback
}

async function loadCurrentStaffMemberId(staffMemberId?: string | null): Promise<string | null> {
  if (staffMemberId) return staffMemberId
  const selfRes = await apiCall<{ member?: { id?: string | null } | null }>('/api/staff/team-members/self')
  if (!selfRes.ok) {
    throw new Error(getErrorMessage(selfRes.result, 'Failed to load current staff member.'))
  }
  return selfRes.result?.member?.id ?? null
}

async function loadProjectDisplay(projectId: string): Promise<Pick<ActiveTimesheetTimer, 'projectName' | 'projectColor'>> {
  const projectRes = await apiCall<{ items?: Array<Record<string, unknown>> }>(
    `/api/staff/timesheets/time-projects?ids=${encodeURIComponent(projectId)}&pageSize=1`,
  )
  if (!projectRes.ok) {
    return { projectName: null, projectColor: null }
  }
  const project = projectRes.result?.items?.[0]
  return {
    projectName: getString(project?.name),
    projectColor: getString(project?.color),
  }
}

async function fetchActiveTimesheetTimer(staffMemberId?: string | null): Promise<ActiveTimesheetTimer> {
  const memberId = await loadCurrentStaffMemberId(staffMemberId)
  if (!memberId) {
    return EMPTY_ACTIVE_TIMER
  }

  const today = getToday()
  const entriesRes = await apiCall<{ items?: Array<Record<string, unknown>> }>(
    `/api/staff/timesheets/time-entries?staffMemberId=${encodeURIComponent(memberId)}&from=${today}&to=${today}&pageSize=50`,
  )
  if (!entriesRes.ok) {
    throw new Error(getErrorMessage(entriesRes.result, 'Failed to load active timer.'))
  }

  const entries = Array.isArray(entriesRes.result?.items) ? entriesRes.result.items : []
  const active = entries.find((entry) => {
    const startedAt = entry.started_at ?? entry.startedAt
    const endedAt = entry.ended_at ?? entry.endedAt
    return startedAt != null && endedAt == null
  })

  if (!active) {
    return { ...EMPTY_ACTIVE_TIMER, staffMemberId: memberId }
  }

  const projectId = getString(active.time_project_id ?? active.timeProjectId)
  const projectDisplay = projectId
    ? await loadProjectDisplay(projectId)
    : { projectName: null, projectColor: null }

  return {
    staffMemberId: memberId,
    entryId: getString(active.id),
    running: true,
    startedAt: getString(active.started_at ?? active.startedAt),
    projectId,
    projectName: projectDisplay.projectName,
    projectColor: projectDisplay.projectColor,
    notes: getString(active.notes),
  }
}

export const activeTimesheetTimerQueryOptions = (staffMemberId?: string | null) => ({
  queryKey: activeTimesheetTimerQueryKey(),
  staleTime: ACTIVE_TIMER_REVALIDATE_MS,
  gcTime: ACTIVE_TIMER_REVALIDATE_MS,
  refetchInterval: ACTIVE_TIMER_REVALIDATE_MS,
  queryFn: () => fetchActiveTimesheetTimer(staffMemberId),
})

export async function refreshActiveTimesheetTimer(
  queryClient: QueryClient,
  staffMemberId?: string | null,
): Promise<ActiveTimesheetTimer> {
  return queryClient.fetchQuery({
    ...activeTimesheetTimerQueryOptions(staffMemberId),
    staleTime: 0,
  })
}

export function useActiveTimesheetTimer(
  options: ActiveTimesheetTimerOptions = {},
): ActiveTimesheetTimerResult {
  const queryClient = useQueryClient()
  const query = useQuery(activeTimesheetTimerQueryOptions(options.staffMemberId))
  const data = query.data ?? EMPTY_ACTIVE_TIMER
  const refresh = React.useCallback(
    () => refreshActiveTimesheetTimer(queryClient, options.staffMemberId),
    [queryClient, options.staffMemberId],
  )

  return {
    ...data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error : null,
    refresh,
  }
}
