/**
 * @jest-environment jsdom
 */
// Stop must always stop the running timer (#8236). Saving an edited note is a
// separate write: when it fails or is blocked, the timer still stops, the typed
// text stays in the field, and the user is told the note was not saved.
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { dismissRecordConflict, surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

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

type MutationInput = {
  operation: () => Promise<unknown>
  context: Record<string, unknown>
}

const mockRefresh = jest.fn(async () => mockTimerStore.state)
const mockRunMutation = jest.fn(async ({ operation }: MutationInput) => operation())

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

const apiCallOrThrowMock = apiCallOrThrow as jest.Mock
const flashMock = flash as jest.Mock
const surfaceRecordConflictMock = surfaceRecordConflict as jest.Mock
const dismissRecordConflictMock = dismissRecordConflict as jest.Mock

function renderTimerBar(onTimerStopped: () => void = jest.fn()) {
  return render(<TimerBar projects={PROJECTS} staffMemberId="staff-1" onTimerStopped={onTimerStopped} />)
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

function stopTimerOnServer() {
  act(() => mockTimerStore.set({ ...IDLE_TIMER }))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockTimerStore.state = {
    running: true,
    entryId: 'entry-1',
    startedAt: new Date().toISOString(),
    projectId: 'p-1',
    notes: 'Build task',
    updatedAt: '2026-01-01T08:00:00.000Z',
  }
  mockRunMutation.mockImplementation(async ({ operation }: MutationInput) => operation())
  mockRefresh.mockImplementation(async () => mockTimerStore.state)
  surfaceRecordConflictMock.mockReturnValue(false)
})

describe('TimerBar — Stop does not depend on the note save', () => {
  it('stops the timer when the note save fails, keeps the typed text and says the note was not saved', async () => {
    const onTimerStopped = jest.fn()
    apiCallOrThrowMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === NOTES_URL && init?.method === 'PUT') throw new Error('network down')
      if (String(url).endsWith('/timer-stop')) stopTimerOnServer()
      return { ok: true, result: { ok: true } }
    })

    renderTimerBar(onTimerStopped)
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Unsaved follow-up' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }))
    })

    await waitFor(() => expect(stopCalls()).toHaveLength(1))
    await waitFor(() => expect(onTimerStopped).toHaveBeenCalledTimes(1))
    expect(notesPutCalls()).toHaveLength(1)
    expect(noteInput()).toHaveValue('Unsaved follow-up')
    expect(flashMock).toHaveBeenCalledWith(expect.stringContaining('Timer stopped, but'), 'warning')
    expect(flashMock).not.toHaveBeenCalledWith(expect.anything(), 'error')
  })

  it('stops the timer when a guarded-mutation widget blocks the note save', async () => {
    mockRunMutation.mockImplementation(async ({ operation, context }: MutationInput) => {
      if (context.action === 'timer-notes') throw new Error('Record conflict detected')
      return operation()
    })
    apiCallOrThrowMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/timer-stop')) stopTimerOnServer()
      return { ok: true, result: { ok: true } }
    })

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Edited in window X again' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }))
    })

    await waitFor(() => expect(stopCalls()).toHaveLength(1))
    expect(noteInput()).toHaveValue('Edited in window X again')
    expect(flashMock).toHaveBeenCalledWith(expect.stringContaining('Timer stopped, but'), 'warning')
  })

  it('stops the timer after a note conflict and clears the conflict bar the note save raised', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409, body: { code: 'optimistic_lock_conflict' } })
    surfaceRecordConflictMock.mockReturnValue(true)
    apiCallOrThrowMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === NOTES_URL && init?.method === 'PUT') throw conflict
      if (String(url).endsWith('/timer-stop')) stopTimerOnServer()
      return { ok: true, result: { ok: true } }
    })

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Stale draft' } })
    await act(async () => {
      fireEvent.keyDown(noteInput(), { key: 'Enter' })
    })
    await waitFor(() => expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }))
    })

    await waitFor(() => expect(stopCalls()).toHaveLength(1))
    expect(dismissRecordConflictMock).toHaveBeenCalled()
    expect(noteInput()).toHaveValue('Stale draft')
    expect(flashMock).toHaveBeenCalledWith(expect.stringContaining('Timer stopped, but'), 'warning')
  })

  it('clears the conflict bar a note conflict raised while stopping', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409, body: { code: 'optimistic_lock_conflict' } })
    apiCallOrThrowMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === NOTES_URL && init?.method === 'PUT') throw conflict
      if (String(url).endsWith('/timer-stop')) stopTimerOnServer()
      return { ok: true, result: { ok: true } }
    })

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Stale draft' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }))
    })

    await waitFor(() => expect(stopCalls()).toHaveLength(1))
    expect(surfaceRecordConflictMock).not.toHaveBeenCalled()
    expect(dismissRecordConflictMock).toHaveBeenCalled()
  })

  it('surfaces a note failure that happens while stopping only once, as the stop warning', async () => {
    let rejectNoteSave: (error: unknown) => void = () => undefined
    apiCallOrThrowMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === NOTES_URL && init?.method === 'PUT') {
        return new Promise((_resolve, reject) => {
          rejectNoteSave = reject
        })
      }
      if (String(url).endsWith('/timer-stop')) stopTimerOnServer()
      return Promise.resolve({ ok: true, result: { ok: true } })
    })

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Typed then stopped' } })
    fireEvent.blur(noteInput())
    await waitFor(() => expect(notesPutCalls()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }))
    await act(async () => {
      rejectNoteSave(new Error('network down'))
    })

    await waitFor(() => expect(stopCalls()).toHaveLength(1))
    expect(notesPutCalls()).toHaveLength(1)
    expect(flashMock).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledWith(expect.stringContaining('Timer stopped, but'), 'warning')
  })

  it('still reports a stop that fails, and keeps the timer and the typed text', async () => {
    apiCallOrThrowMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === NOTES_URL && init?.method === 'PUT') throw new Error('network down')
      if (String(url).endsWith('/timer-stop')) throw new Error('stop failed')
      return { ok: true, result: { ok: true } }
    })

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Unsaved follow-up' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }))
    })

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Failed to stop timer', 'error'))
    expect(screen.getByRole('button', { name: 'Stop timer' })).toBeTruthy()
    expect(noteInput()).toHaveValue('Unsaved follow-up')
  })
})

describe('TimerBar — guarded writes do not open a record-lock editing session', () => {
  it('sends start, note and stop writes without a record-lock resource', async () => {
    apiCallOrThrowMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/timer-stop')) stopTimerOnServer()
      return { ok: true, result: { ok: true } }
    })

    renderTimerBar()
    await waitFor(() => expect(noteInput()).toHaveValue('Build task'))

    fireEvent.change(noteInput(), { target: { value: 'Build task, reviewed' } })
    await act(async () => {
      fireEvent.keyDown(noteInput(), { key: 'Enter' })
    })
    await waitFor(() => expect(notesPutCalls()).toHaveLength(1))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }))
    })
    await waitFor(() => expect(stopCalls()).toHaveLength(1))

    const contexts = mockRunMutation.mock.calls.map(([input]) => (input as MutationInput).context)
    expect(contexts.map((context) => context.action)).toEqual(['timer-notes', 'timer-stop'])
    for (const context of contexts) {
      expect(context).not.toHaveProperty('resourceKind')
      expect(context).not.toHaveProperty('resourceId')
    }
  })
})
