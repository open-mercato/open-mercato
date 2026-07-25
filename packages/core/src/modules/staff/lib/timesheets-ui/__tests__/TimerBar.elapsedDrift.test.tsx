/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { TimerBar } from '../TimerBar'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const mockRetryLastMutation = jest.fn(async () => true)
const mockTranslate = (_key: string, fallback?: string) => fallback ?? ''

const mockStartIso = '2026-07-02T10:00:00.000Z'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: mockRetryLastMutation,
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
}))

// The active timer is now owned by the shared useActiveTimesheetTimer hook
// (issue #3307). This test isolates TimerBar's own elapsed-counter logic, so it
// stubs the hook with a running timer instead of exercising its data fetching.
jest.mock('../useActiveTimesheetTimer', () => ({
  useActiveTimesheetTimer: () => ({
    staffMemberId: 'staff-1',
    entryId: 'entry-1',
    running: true,
    startedAt: mockStartIso,
    projectId: 'project-1',
    projectName: 'Build',
    projectColor: null,
    notes: '',
    isLoading: false,
    error: null,
    refresh: jest.fn(async () => undefined),
  }),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const mockApiCallOrThrow = apiCallOrThrow as jest.MockedFunction<typeof apiCallOrThrow>

const projects = [
  { id: 'project-1', name: 'Build', code: 'BLD', color: null },
]

const START_MS = Date.parse(mockStartIso)

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('TimerBar elapsed counter drift', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
    mockApiCallOrThrow.mockResolvedValue({ result: { id: 'entry-1' } } as any)
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } } as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('recomputes elapsed from wall-clock time so it stays accurate when interval ticks are throttled', async () => {
    let intervalCallback: (() => void) | null = null
    jest.spyOn(global, 'setInterval').mockImplementation(((cb: () => void) => {
      intervalCallback = cb
      return 1 as unknown as ReturnType<typeof setInterval>
    }) as typeof setInterval)
    jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined)

    let currentNow = START_MS
    jest.spyOn(Date, 'now').mockImplementation(() => currentNow)

    render(<TimerBar projects={projects} staffMemberId="staff-1" onTimerStopped={jest.fn()} />)
    await flushMicrotasks()

    // Active timer detected on mount; elapsed initialised to zero.
    expect(screen.getByRole('button', { name: 'Stop timer' })).toBeInTheDocument()
    expect(screen.getByText('0:00:00')).toBeInTheDocument()
    expect(intervalCallback).toBeTruthy()

    // Simulate a backgrounded/minimized tab: two real minutes elapsed on the
    // wall clock, but the throttled interval only got to fire a single tick.
    currentNow = START_MS + 120_000
    act(() => { intervalCallback!() })

    // Tick-counting would show 0:00:01; recomputing from Date.now shows 0:02:00.
    expect(screen.getByText('0:02:00')).toBeInTheDocument()
  })
})
