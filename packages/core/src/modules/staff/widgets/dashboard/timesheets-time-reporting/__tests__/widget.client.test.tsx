/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const SERVER_MESSAGE = 'Inny licznik czasu jest już uruchomiony.'
const mockApiCall = jest.fn(async (url: string) => {
  if (url.includes('/api/staff/team-members/self')) {
    return { ok: true, status: 200, result: { member: { id: MEMBER_ID } } }
  }
  if (url.includes('/api/staff/timesheets/time-entries')) {
    return { ok: true, status: 200, result: { items: [] } }
  }
  return { ok: true, status: 200, result: {} }
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  // Stable translate reference: the widget's loadState effect depends on `t`,
  // so a fresh function per render would re-trigger the load and keep the
  // widget in its loading state forever (the real useT is memoized).
  const translate = (_key: string, fallback?: string) => fallback ?? _key
  return { useT: () => translate }
})

const startTimerEntry = jest.fn()
jest.mock('../../../../lib/timesheets-ui/startTimer', () => ({
  startTimerEntry: (...args: unknown[]) => startTimerEntry(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: mockApiCall,
  readApiResultOrThrow: jest.fn(async (url: string) => {
    if (url.includes('/api/staff/timesheets/my-projects')) {
      return { items: [{ time_project_id: PROJECT_ID }] }
    }
    if (url.includes('/api/staff/timesheets/time-projects')) {
      return { items: [{ id: PROJECT_ID, name: 'Acme', code: null }] }
    }
    if (url.includes('/api/staff/team-members/self')) {
      return { member: { id: MEMBER_ID } }
    }
    if (url.includes('/api/staff/timesheets/time-entries')) {
      return { items: [] }
    }
    return { items: [] }
  }),
}))

import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { setClientDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-store'
import { todayInZone } from '@open-mercato/ui/primitives/date-format'
import { clockFromApiValue, combineDateAndClock } from '../../../../lib/time-tracking-ui/timeEntryDialogState'
import TimeReportingWidget from '../widget.client'

const noEnv = { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null }

function renderWidget() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TimeReportingWidget
        mode={'view' as never}
        settings={{ lastProjectId: null } as never}
        onSettingsChange={jest.fn()}
        refreshToken={0}
        onRefreshStateChange={jest.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('TimeReportingWidget start error surfacing (issue #3507)', () => {
  beforeEach(() => {
    startTimerEntry.mockReset()
    mockApiCall.mockClear()
  })

  it('surfaces the localized server message in an announced alert when start is rejected', async () => {
    // The atomic start-timer route rejects a second concurrent start with a
    // localized 409 message (carried on the thrown error's `status` + message).
    startTimerEntry.mockRejectedValue(Object.assign(new Error(SERVER_MESSAGE), { status: 409 }))

    renderWidget()

    // Wait for the start form to hydrate, then pick the assigned project.
    const projectSelect = (await screen.findByLabelText('Project')) as HTMLSelectElement
    fireEvent.change(projectSelect, { target: { value: PROJECT_ID } })

    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }))

    // BUG-002: the error is rendered in a live region (role="alert").
    // BUG-001: the live region shows the server's localized reason, not the
    // generic English fallback.
    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toBe(SERVER_MESSAGE)
    })
    expect(screen.queryByText('Failed to start timer')).toBeNull()
  })
})

describe('TimeReportingWidget entry date', () => {
  const startedAt = '2026-07-20T22:30:00.000Z'
  const startedAtLocal = new Date(startedAt)
  const browserDay = [
    startedAtLocal.getFullYear(),
    String(startedAtLocal.getMonth() + 1).padStart(2, '0'),
    String(startedAtLocal.getDate()).padStart(2, '0'),
  ].join('-')
  const configuredZone = browserDay === '2026-07-20' ? 'Asia/Tokyo' : 'Pacific/Honolulu'

  beforeEach(() => {
    startTimerEntry.mockReset()
    startTimerEntry.mockResolvedValue({ id: 'entry-1' })
    jest.useFakeTimers({
      now: new Date(startedAt),
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'nextTick'],
    })
    setClientDateLocaleSettings(resolveDateLocaleSettings({ tenant: { timeZone: configuredZone }, env: noEnv }))
  })

  afterEach(() => {
    jest.useRealTimers()
    setClientDateLocaleSettings(null)
  })

  it('stores the browser day so the entry editor rebuilds the same start instant', async () => {
    expect(todayInZone(configuredZone, startedAtLocal)).not.toBe(browserDay)
    renderWidget()

    const projectSelect = (await screen.findByLabelText('Project')) as HTMLSelectElement
    fireEvent.change(projectSelect, { target: { value: PROJECT_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }))

    await waitFor(() => expect(startTimerEntry).toHaveBeenCalledTimes(1))
    const payload = startTimerEntry.mock.calls[0][0] as { date: string }
    expect(payload.date).toBe(browserDay)
    expect(combineDateAndClock(payload.date, clockFromApiValue(startedAt))).toBe(startedAt)
  })
})
