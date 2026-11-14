/**
 * @jest-environment jsdom
 */
// The running-note save is an edit surface on StaffTimeEntry, so it carries the
// entry's version and surfaces a 409 through the shared conflict bar.
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
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
})

describe('TimerBar — running-note save uses optimistic locking', () => {
  it('sends the running entry version with the note save and re-reads it afterwards', async () => {
    apiCallOrThrowMock.mockResolvedValue({ ok: true, result: { ok: true } })

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Build task, reviewed' } })
    fireEvent.blur(noteInput())

    await waitFor(() => expect(notesPutCalls()).toHaveLength(1))
    expect(withScopedHeadersMock).toHaveBeenCalledWith(buildOptimisticLockHeader(ENTRY_VERSION), expect.any(Function))
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
  })

  it('surfaces a version conflict through the conflict bar instead of the generic error flash', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409 })
    apiCallOrThrowMock.mockRejectedValue(conflict)
    surfaceRecordConflictMock.mockReturnValue(true)

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Build task, reviewed' } })
    await act(async () => {
      fireEvent.blur(noteInput())
    })

    await waitFor(() => expect(surfaceRecordConflictMock).toHaveBeenCalledWith(conflict, expect.any(Function), expect.any(Object)))
    expect(flashMock).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('keeps the typed text when the user refreshes from the conflict bar, and saves it against the latest version', async () => {
    const remoteVersion = '2026-01-01T08:05:00.000Z'
    const conflict = Object.assign(new Error('conflict'), { status: 409 })
    apiCallOrThrowMock.mockRejectedValue(conflict)
    surfaceRecordConflictMock.mockReturnValue(true)
    mockRefresh.mockImplementation(async () => mockTimerStore.state)

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'My unsaved draft' } })
    act(() => mockTimerStore.set({ notes: 'Edited in another tab', updatedAt: remoteVersion }))
    await act(async () => {})
    expect(noteInput()).toHaveValue('My unsaved draft')

    await act(async () => {
      fireEvent.blur(noteInput())
    })
    await waitFor(() => expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1))
    expect(withScopedHeadersMock).toHaveBeenCalledWith(buildOptimisticLockHeader(ENTRY_VERSION), expect.any(Function))

    const [, , options] = surfaceRecordConflictMock.mock.calls[0] as [unknown, unknown, { onRefresh: () => void }]
    flashMock.mockClear()
    await act(async () => {
      options.onRefresh()
    })

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith(expect.stringContaining('Edited in another tab'), 'info'))
    expect(noteInput()).toHaveValue('My unsaved draft')

    apiCallOrThrowMock.mockResolvedValue({ ok: true, result: { ok: true } })
    await act(async () => {
      fireEvent.keyDown(noteInput(), { key: 'Enter' })
    })
    await waitFor(() => expect(notesPutCalls()).toHaveLength(2))
    expect(JSON.parse(String((notesPutCalls()[1][1] as { body: string }).body))).toEqual({
      id: 'entry-1',
      notes: 'My unsaved draft',
    })
    expect(withScopedHeadersMock).toHaveBeenLastCalledWith(buildOptimisticLockHeader(remoteVersion), expect.any(Function))
  })

  it('adopts the latest note quietly on refresh when it already matches the typed text', async () => {
    const remoteVersion = '2026-01-01T08:05:00.000Z'
    const conflict = Object.assign(new Error('conflict'), { status: 409 })
    apiCallOrThrowMock.mockRejectedValue(conflict)
    surfaceRecordConflictMock.mockReturnValue(true)

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Same words' } })
    await act(async () => {
      fireEvent.blur(noteInput())
    })
    await waitFor(() => expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1))

    act(() => mockTimerStore.set({ notes: 'Same words', updatedAt: remoteVersion }))
    flashMock.mockClear()
    const [, , options] = surfaceRecordConflictMock.mock.calls[0] as [unknown, unknown, { onRefresh: () => void }]
    await act(async () => {
      options.onRefresh()
    })

    expect(noteInput()).toHaveValue('Same words')
    expect(flashMock).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.blur(noteInput())
    })
    expect(notesPutCalls()).toHaveLength(1)
  })

  it('does not raise a false conflict when its own save is only seen by a later refetch', async () => {
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
    await waitFor(() => expect(noteInput()).not.toBeDisabled())

    fireEvent.change(noteInput(), { target: { value: 'First edit, then more' } })
    act(() => mockTimerStore.set({ notes: 'First edit', updatedAt: savedVersion }))
    await act(async () => {})

    expect(flashMock).not.toHaveBeenCalled()
    expect(noteInput()).toHaveValue('First edit, then more')

    await act(async () => {
      fireEvent.keyDown(noteInput(), { key: 'Enter' })
    })
    await waitFor(() => expect(notesPutCalls()).toHaveLength(2))
    expect(withScopedHeadersMock).toHaveBeenLastCalledWith(buildOptimisticLockHeader(savedVersion), expect.any(Function))
  })

  it('falls back to the error flash when the failure is not a version conflict', async () => {
    apiCallOrThrowMock.mockRejectedValue(new Error('boom'))

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Build task, reviewed' } })
    await act(async () => {
      fireEvent.blur(noteInput())
    })

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith(expect.any(String), 'error'))
  })
})
