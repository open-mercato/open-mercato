/**
 * @jest-environment jsdom
 */
// A timer driven from more than one window: the note field follows the entry it
// belongs to, an unsaved draft is never dropped silently, and a stale window goes
// idle instead of reporting false conflicts (#9079).
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { dismissRecordConflict, surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type MockTimerState = {
  running: boolean
  entryId: string | null
  startedAt: string | null
  projectId: string | null
  notes: string | null
  updatedAt: string | null
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
  const translate = (_key: string, fallback?: string, params?: Record<string, string>) =>
    Object.entries(params ?? {}).reduce(
      (text, [name, value]) => text.replace(`{${name}}`, value),
      fallback ?? _key,
    )
  return { useT: () => translate }
})

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
  dismissRecordConflict: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: Record<string, string>, run: () => unknown) => run()),
}))
jest.mock('../startTimer', () => ({ startTimerEntry: jest.fn() }))

import { TimerBar } from '../TimerBar'

const PROJECTS = [{ id: 'p-1', name: 'Apollo', code: 'AP', color: null }]
const NOTES_URL = '/api/staff/timesheets/time-entries'
const ENTRY_VERSION = '2026-01-01T08:00:00.000Z'

const apiCallOrThrowMock = apiCallOrThrow as jest.Mock
const withScopedHeadersMock = withScopedApiRequestHeaders as jest.Mock
const surfaceRecordConflictMock = surfaceRecordConflict as jest.Mock
const flashMock = flash as jest.Mock
const dismissRecordConflictMock = dismissRecordConflict as jest.Mock

function renderTimerBar(onTimerStopped: () => void = jest.fn()) {
  return render(<TimerBar projects={PROJECTS} staffMemberId="staff-1" onTimerStopped={onTimerStopped} />)
}

function stopCalls() {
  return apiCallOrThrowMock.mock.calls.filter(([url]) => String(url).endsWith('/timer-stop'))
}

function noteInput(): HTMLInputElement {
  return screen.getByPlaceholderText('What are you working on?') as HTMLInputElement
}

function notesPutCalls() {
  return apiCallOrThrowMock.mock.calls.filter(
    ([url, init]) => url === NOTES_URL && (init as { method?: string } | undefined)?.method === 'PUT',
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockTimerStore.state = {
    running: true,
    entryId: 'entry-1',
    startedAt: new Date().toISOString(),
    projectId: 'p-1',
    notes: 'Build task',
    updatedAt: ENTRY_VERSION,
  }
  surfaceRecordConflictMock.mockReturnValue(false)
  mockRefresh.mockImplementation(async () => mockTimerStore.state)
})

describe('TimerBar — a timer used from more than one window (#9079)', () => {
  it('clears the stopped entry\'s note when another window stops the timer, so Start here does not reuse it', async () => {
    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    act(() => mockTimerStore.set({ ...IDLE_TIMER }))
    await waitFor(() => expect(noteInput()).toHaveValue(''))
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('reports an unsaved draft dropped because the timer stopped elsewhere', async () => {
    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Half-typed draft' } })
    act(() => mockTimerStore.set({ ...IDLE_TIMER }))

    await waitFor(() => expect(noteInput()).toHaveValue(''))
    expect(flashMock).toHaveBeenCalledWith(expect.stringContaining('Half-typed draft'), 'warning')
  })

  it('reports an unsaved draft dropped when a timer started elsewhere is adopted', async () => {
    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Half-typed draft' } })
    act(() =>
      mockTimerStore.set({ entryId: 'entry-2', notes: null, updatedAt: '2026-01-01T09:00:00.000Z' }),
    )

    await waitFor(() => expect(noteInput()).toHaveValue(''))
    expect(flashMock).toHaveBeenCalledWith(expect.stringContaining('Half-typed draft'), 'warning')
    expect(notesPutCalls()).toHaveLength(0)
  })

  it('re-reads the version before the next save when the read after its own save did not land', async () => {
    const savedVersion = '2026-01-01T08:01:00.000Z'
    apiCallOrThrowMock.mockResolvedValue({ ok: true, result: { ok: true } })
    mockRefresh.mockRejectedValueOnce(new Error('timeout'))

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'First edit' } })
    await act(async () => {
      fireEvent.keyDown(noteInput(), { key: 'Enter' })
    })
    await waitFor(() => expect(notesPutCalls()).toHaveLength(1))
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))

    mockRefresh.mockImplementationOnce(async () => ({
      ...mockTimerStore.state,
      notes: 'First edit',
      updatedAt: savedVersion,
    }))
    fireEvent.change(noteInput(), { target: { value: 'First edit, then more' } })
    await act(async () => {
      fireEvent.keyDown(noteInput(), { key: 'Enter' })
    })

    await waitFor(() => expect(notesPutCalls()).toHaveLength(2))
    expect(withScopedHeadersMock).toHaveBeenLastCalledWith(buildOptimisticLockHeader(savedVersion), expect.any(Function))
  })

  it('goes idle without a note conflict when Stop finds the timer already stopped elsewhere', async () => {
    const onTimerStopped = jest.fn()
    const noteConflict = Object.assign(new Error('conflict'), { status: 409 })
    const noActiveSegment = Object.assign(new Error('No active timer segment found for this entry.'), { status: 409 })
    apiCallOrThrowMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/timer-stop')) throw noActiveSegment
      throw noteConflict
    })
    mockRefresh.mockImplementation(async () => {
      mockTimerStore.set({ ...IDLE_TIMER })
      return mockTimerStore.state
    })

    renderTimerBar(onTimerStopped)
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Typed before Stop' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }))
    })

    await waitFor(() => expect(onTimerStopped).toHaveBeenCalledTimes(1))
    expect(stopCalls()).toHaveLength(1)
    expect(dismissRecordConflictMock).toHaveBeenCalled()
    expect(flashMock).toHaveBeenCalledWith('This timer was already stopped in another window.', 'info')
    expect(flashMock).toHaveBeenCalledWith(expect.stringContaining('Typed before Stop'), 'warning')
    expect(flashMock).not.toHaveBeenCalledWith(expect.anything(), 'error')
    expect(screen.getByRole('button', { name: 'Start timer' })).toBeInTheDocument()
  })
})
