/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  activeTimesheetTimerQueryKey,
  refreshActiveTimesheetTimer,
  useActiveTimesheetTimer,
} from '../useActiveTimesheetTimer'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>

function ok<T>(result: T) {
  return { ok: true, status: 200, result, response: new Response() } as Awaited<ReturnType<typeof apiCall>>
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

function setupRunningTimerResponses() {
  apiCallMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/staff/team-members/self') {
      return ok({ member: { id: 'member-1' } })
    }
    if (url.startsWith('/api/staff/timesheets/time-entries?')) {
      return ok({
        items: [
          {
            id: 'entry-1',
            time_project_id: 'project-1',
            started_at: '2026-06-19T08:00:00.000Z',
            ended_at: null,
            notes: 'Build shared timer state',
          },
        ],
      })
    }
    if (url.startsWith('/api/staff/timesheets/time-projects?')) {
      return ok({ items: [{ id: 'project-1', name: 'Platform', color: 'blue' }] })
    }
    return ok({})
  })
}

describe('useActiveTimesheetTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-19T10:00:00.000Z'))
    apiCallMock.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('dedupes active timer loading across mounted subscribers', async () => {
    setupRunningTimerResponses()
    const { wrapper } = createWrapper()

    const first = renderHook(() => useActiveTimesheetTimer(), { wrapper })
    const second = renderHook(() => useActiveTimesheetTimer(), { wrapper })

    await waitFor(() => expect(first.result.current.entryId).toBe('entry-1'))
    expect(second.result.current.entryId).toBe('entry-1')
    expect(first.result.current.projectName).toBe('Platform')

    expect(apiCallMock.mock.calls.filter(([url]) => String(url) === '/api/staff/team-members/self')).toHaveLength(1)
    expect(apiCallMock.mock.calls.filter(([url]) => String(url).startsWith('/api/staff/timesheets/time-entries?'))).toHaveLength(1)
    expect(apiCallMock.mock.calls.filter(([url]) => String(url).startsWith('/api/staff/timesheets/time-projects?'))).toHaveLength(1)
  })

  it('looks up the active timer by running state rather than today (issue #3717)', async () => {
    setupRunningTimerResponses()
    const { wrapper } = createWrapper()

    const { result } = renderHook(() => useActiveTimesheetTimer(), { wrapper })

    await waitFor(() => expect(result.current.entryId).toBe('entry-1'))

    const entriesCall = apiCallMock.mock.calls.find(([url]) =>
      String(url).startsWith('/api/staff/timesheets/time-entries?'),
    )
    const entriesUrl = String(entriesCall?.[0] ?? '')
    expect(entriesUrl).toContain('running=true')
    // A date-scoped lookup hides a timer started before midnight after the date rolls over.
    expect(entriesUrl).not.toContain('from=')
    expect(entriesUrl).not.toContain('to=')
  })

  it('shares the revalidation window but allows forced refresh after mutations', async () => {
    setupRunningTimerResponses()
    const { queryClient, wrapper } = createWrapper()

    const { result } = renderHook(() => useActiveTimesheetTimer(), { wrapper })

    await waitFor(() => expect(result.current.entryId).toBe('entry-1'))
    await act(async () => {
      await queryClient.ensureQueryData({
        queryKey: activeTimesheetTimerQueryKey(),
        queryFn: async () => {
          throw new Error('should reuse cache')
        },
        staleTime: 30_000,
      })
    })

    expect(apiCallMock.mock.calls.filter(([url]) => String(url).startsWith('/api/staff/timesheets/time-entries?'))).toHaveLength(1)

    await act(async () => {
      await refreshActiveTimesheetTimer(queryClient)
    })

    expect(apiCallMock.mock.calls.filter(([url]) => String(url).startsWith('/api/staff/timesheets/time-entries?'))).toHaveLength(2)
  })

  it('does not let a refresh after a write reuse a background fetch that started before the write', async () => {
    const { queryClient, wrapper } = createWrapper()
    let entriesCalls = 0
    let releaseBackgroundFetch: () => void = () => undefined
    apiCallMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/staff/team-members/self') return ok({ member: { id: 'member-1' } })
      if (url.startsWith('/api/staff/timesheets/time-projects?')) return ok({ items: [] })
      if (url.startsWith('/api/staff/timesheets/time-entries?')) {
        entriesCalls += 1
        const entry = (notes: string, updatedAt: string) => ok({
          items: [{ id: 'entry-1', started_at: '2026-06-19T08:00:00.000Z', ended_at: null, notes, updated_at: updatedAt }],
        })
        if (entriesCalls === 1) return entry('Before the write', '2026-06-19T09:00:00.000Z')
        if (entriesCalls === 2) {
          await new Promise<void>((resolve) => {
            releaseBackgroundFetch = resolve
          })
          return entry('Before the write', '2026-06-19T09:00:00.000Z')
        }
        return entry('After the write', '2026-06-19T09:30:00.000Z')
      }
      return ok({})
    })

    const { result } = renderHook(() => useActiveTimesheetTimer(), { wrapper })
    await waitFor(() => expect(result.current.notes).toBe('Before the write'))

    let backgroundFetch: Promise<unknown> = Promise.resolve()
    act(() => {
      backgroundFetch = queryClient.refetchQueries({ queryKey: activeTimesheetTimerQueryKey() })
    })
    await waitFor(() => expect(entriesCalls).toBe(2))

    let refreshed: Awaited<ReturnType<typeof refreshActiveTimesheetTimer>> | null = null
    await act(async () => {
      const refresh = refreshActiveTimesheetTimer(queryClient)
      releaseBackgroundFetch()
      refreshed = await refresh
      await backgroundFetch.catch(() => undefined)
    })

    expect(refreshed).toEqual(expect.objectContaining({ notes: 'After the write', updatedAt: '2026-06-19T09:30:00.000Z' }))
    await waitFor(() => expect(result.current.notes).toBe('After the write'))
  })
})
