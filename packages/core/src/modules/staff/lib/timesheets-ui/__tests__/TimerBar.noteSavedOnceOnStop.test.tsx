/**
 * @jest-environment jsdom
 */
// Its own file for the same reason as `TimerBar.noteClearedOnStop`: the mock timer
// store is module-level, so a case here must start from a clean running timer.
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type MockTimerState = {
  running: boolean
  entryId: string | null
  startedAt: string | null
  projectId: string | null
  notes: string | null
}

const IDLE_TIMER: MockTimerState = {
  running: false,
  entryId: null,
  startedAt: null,
  projectId: null,
  notes: null,
}

// A tiny external store so a test can flip the active timer mid-flight and have the
// mounted TimerBar re-render, the way the real react-query cache update would.
const mockTimerStore = {
  state: { ...IDLE_TIMER } as MockTimerState,
  listeners: new Set<() => void>(),
  set(next: Partial<MockTimerState>) {
    mockTimerStore.state = { ...mockTimerStore.state, ...next }
    mockTimerStore.listeners.forEach((listener) => listener())
  },
  subscribe(listener: () => void) {
    mockTimerStore.listeners.add(listener)
    return () => {
      mockTimerStore.listeners.delete(listener)
    }
  },
}

const mockRefresh = jest.fn(async () => mockTimerStore.state)
const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())

jest.mock('../useActiveTimesheetTimer', () => {
  const ReactActual = jest.requireActual('react') as typeof React
  return {
    useActiveTimesheetTimer: () => {
      const state = ReactActual.useSyncExternalStore(
        mockTimerStore.subscribe,
        () => mockTimerStore.state,
      )
      return {
        staffMemberId: 'staff-1',
        ...state,
        projectName: null,
        projectColor: null,
        isLoading: false,
        isFetching: false,
        error: null,
        refresh: mockRefresh,
      }
    },
  }
})

jest.mock('../useTimesheetPreference', () => ({
  useTimesheetPreference: () => ({
    lastProjectId: 'p-1',
    updatedAt: null,
    isLoading: false,
    isFetching: false,
    error: null,
    save: jest.fn().mockResolvedValue(undefined),
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (_key: string, fallback?: string) => fallback ?? _key
  return { useT: () => translate }
})

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
}))
jest.mock('../startTimer', () => ({ startTimerEntry: jest.fn() }))

import { TimerBar } from '../TimerBar'

const PROJECTS = [{ id: 'p-1', name: 'Apollo', code: 'AP', color: null }]
const NOTES_URL = '/api/staff/timesheets/time-entries'

const apiCallOrThrowMock = apiCallOrThrow as jest.Mock

function renderTimerBar() {
  return render(<TimerBar projects={PROJECTS} staffMemberId="staff-1" onTimerStopped={jest.fn()} />)
}

function noteInput(): HTMLInputElement {
  return screen.getByPlaceholderText('What are you working on?') as HTMLInputElement
}

function notesPutCalls() {
  return apiCallOrThrowMock.mock.calls.filter(
    ([url, init]) => url === NOTES_URL && (init as { method?: string } | undefined)?.method === 'PUT',
  )
}

function stopCalls() {
  return apiCallOrThrowMock.mock.calls.filter(([url]) => String(url).endsWith('/timer-stop'))
}

function runningTimer(notes: string | null): Partial<MockTimerState> {
  return {
    running: true,
    entryId: 'entry-1',
    startedAt: new Date().toISOString(),
    projectId: 'p-1',
    notes,
  }
}

describe('TimerBar — editing the note and then stopping saves it once', () => {
  it('joins the blur save already in flight instead of sending a second PUT', async () => {
    // Clicking Stop blurs the note field first, which starts a save; the click then
    // reaches `handleStop`, whose own save closed over the same not-yet-updated
    // baseline. Without joining the in-flight save that was two identical writes
    // and two "Update time entry" audit records.
    mockTimerStore.state = { ...IDLE_TIMER, ...runningTimer('Build task') } as MockTimerState
    let releaseNoteSave: () => void = () => undefined
    apiCallOrThrowMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === NOTES_URL && init?.method === 'PUT') {
        return new Promise((resolve) => {
          releaseNoteSave = () => resolve({ ok: true, result: { ok: true } })
        })
      }
      return Promise.resolve({ ok: true, result: { ok: true } })
    })

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Build task, reviewed' } })
    fireEvent.blur(noteInput())
    await waitFor(() => expect(notesPutCalls()).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }))
    await act(async () => {
      releaseNoteSave()
    })

    await waitFor(() => expect(stopCalls()).toHaveLength(1))
    expect(notesPutCalls()).toHaveLength(1)
    expect(JSON.parse(String((notesPutCalls()[0][1] as { body: string }).body))).toEqual({
      id: 'entry-1',
      notes: 'Build task, reviewed',
    })
  })
})
