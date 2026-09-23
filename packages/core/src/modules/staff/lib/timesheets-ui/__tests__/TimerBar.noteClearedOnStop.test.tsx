/**
 * @jest-environment jsdom
 */
// Its own file rather than a case in `TimerBar.noteDuringStart`: that suite's mock
// timer store is module-level and its earlier cases leave a running timer and a
// pending note sync behind, which seed this component's field after the stop.
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { startTimerEntry } from '../startTimer'

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
const startTimerEntryMock = startTimerEntry as jest.Mock
const flashMock = flash as jest.Mock

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

describe('TimerBar — the note is cleared when the timer stops', () => {
  it('does not let the next timer inherit, or persist, the previous note', async () => {
    // The note has already been saved onto the entry that just stopped. Left in
    // the field it was sent again by the next start (`notes: description || null`),
    // so a fresh timer silently persisted the previous task's note onto a brand
    // new entry — wrong data on the server, not just a stale-looking input.
    mockTimerStore.state = { ...IDLE_TIMER, ...runningTimer('Build task') } as MockTimerState
    apiCallOrThrowMock.mockResolvedValue({ ok: true, result: { ok: true } })

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }))
    await waitFor(() => expect(stopCalls()).toHaveLength(1))
    await act(async () => {
      mockTimerStore.set({ ...IDLE_TIMER })
    })

    await waitFor(() => expect(noteInput()).toHaveValue(''))

    startTimerEntryMock.mockResolvedValue({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }))
    await waitFor(() => expect(startTimerEntryMock).toHaveBeenCalled())
    expect(startTimerEntryMock.mock.calls[0][0]).toEqual(expect.objectContaining({ notes: null }))
  })
})
