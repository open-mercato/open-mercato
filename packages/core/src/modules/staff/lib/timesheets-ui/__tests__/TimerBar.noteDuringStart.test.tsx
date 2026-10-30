/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { startTimerEntry } from '../startTimer'

type MockTimerState = {
  running: boolean
  entryId: string | null
  startedAt: string | null
  projectId: string | null
  notes: string | null
  updatedAt?: string | null
}

const IDLE_TIMER: MockTimerState = {
  running: false,
  entryId: null,
  startedAt: null,
  projectId: null,
  notes: null,
  updatedAt: null,
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
  withScopedApiRequestHeaders: jest.fn((_headers: Record<string, string>, run: () => unknown) => run()),
}))
jest.mock('../startTimer', () => ({ startTimerEntry: jest.fn() }))

import { TimerBar } from '../TimerBar'

const PROJECTS = [{ id: 'p-1', name: 'Apollo', code: 'AP', color: null }]
const NOTES_URL = '/api/staff/timesheets/time-entries'

const apiCallOrThrowMock = apiCallOrThrow as jest.Mock
const startTimerEntryMock = startTimerEntry as jest.Mock
const flashMock = flash as jest.Mock
const withScopedHeadersMock = withScopedApiRequestHeaders as jest.Mock

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

function runningTimer(notes: string | null): Partial<MockTimerState> {
  return {
    running: true,
    entryId: 'entry-1',
    startedAt: new Date().toISOString(),
    projectId: 'p-1',
    notes,
  }
}

describe('TimerBar — note typed while a start is in flight', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockTimerStore.state = { ...IDLE_TIMER }
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
    apiCallOrThrowMock.mockResolvedValue({ ok: true, result: { ok: true } })
  })

  it('keeps a note edited during the start round-trip and saves it once the timer runs', async () => {
    let resolveStart: (value: { id: string }) => void = () => {}
    startTimerEntryMock.mockImplementation(
      () => new Promise<{ id: string }>((resolve) => {
        resolveStart = resolve
      }),
    )
    mockRefresh.mockImplementation(async () => {
      if (!mockTimerStore.state.running) {
        act(() => mockTimerStore.set(runningTimer('Initial note')))
      } else {
        const puts = notesPutCalls()
        const lastPut = puts[puts.length - 1] as [string, { body: string }] | undefined
        if (lastPut) act(() => mockTimerStore.set({ notes: JSON.parse(lastPut[1].body).notes }))
      }
      return mockTimerStore.state
    })

    renderTimerBar()
    fireEvent.change(noteInput(), { target: { value: 'Initial note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }))
    await waitFor(() => expect(startTimerEntryMock).toHaveBeenCalledTimes(1))

    fireEvent.change(noteInput(), { target: { value: 'Updated note' } })
    fireEvent.keyDown(noteInput(), { key: 'Enter' })

    await act(async () => {
      resolveStart({ id: 'entry-1' })
    })

    await screen.findByRole('button', { name: 'Stop timer' })
    await waitFor(() => expect(notesPutCalls()).toHaveLength(1))
    expect(noteInput()).toHaveValue('Updated note')
    const [, init] = notesPutCalls()[0] as [string, { body: string }]
    expect(JSON.parse(init.body)).toEqual({ id: 'entry-1', notes: 'Updated note' })

    await act(async () => {})
    expect(notesPutCalls()).toHaveLength(1)
  })

  it('adopts the server note into the field when there is no unsaved local edit', async () => {
    renderTimerBar()
    expect(noteInput()).toHaveValue('')

    act(() => mockTimerStore.set(runningTimer('Server note')))
    await waitFor(() => expect(noteInput()).toHaveValue('Server note'))

    act(() => mockTimerStore.set({ notes: 'Edited in another tab' }))
    await waitFor(() => expect(noteInput()).toHaveValue('Edited in another tab'))

    expect(notesPutCalls()).toHaveLength(0)
  })

  it('keeps a dirty draft and its base version when a refetch of the same entry brings a new remote note', async () => {
    const draftBaseVersion = '2026-01-01T08:00:00.000Z'
    const remoteVersion = '2026-01-01T08:05:00.000Z'
    mockTimerStore.state = {
      ...IDLE_TIMER,
      ...runningTimer('Server note'),
      updatedAt: draftBaseVersion,
    } as MockTimerState

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Server note'))

    fireEvent.change(noteInput(), { target: { value: 'My unsaved draft' } })
    act(() => mockTimerStore.set({ notes: 'Edited in another tab', updatedAt: remoteVersion }))
    await act(async () => {})

    expect(noteInput()).toHaveValue('My unsaved draft')
    expect(notesPutCalls()).toHaveLength(0)
    expect(flashMock).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledWith(expect.stringContaining('changed in another tab'), 'warning')

    fireEvent.blur(noteInput())
    await waitFor(() => expect(notesPutCalls()).toHaveLength(1))
    const [, init] = notesPutCalls()[0] as [string, { body: string }]
    expect(JSON.parse(init.body)).toEqual({ id: 'entry-1', notes: 'My unsaved draft' })
    expect(withScopedHeadersMock).toHaveBeenCalledWith(
      buildOptimisticLockHeader(draftBaseVersion),
      expect.any(Function),
    )
  })

  it('does not save a draft note onto a timer started elsewhere', async () => {
    renderTimerBar()
    fireEvent.change(noteInput(), { target: { value: 'Draft note' } })

    act(() => mockTimerStore.set(runningTimer('Server note')))
    await waitFor(() => expect(noteInput()).toHaveValue('Server note'))

    await act(async () => {})
    expect(notesPutCalls()).toHaveLength(0)
    expect(startTimerEntryMock).not.toHaveBeenCalled()
  })
})
