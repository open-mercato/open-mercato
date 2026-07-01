/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TimerBar } from '../TimerBar'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const mockRetryLastMutation = jest.fn(async () => true)
const mockTranslate = (_key: string, fallback?: string) => fallback ?? ''

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

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const mockApiCallOrThrow = apiCallOrThrow as jest.MockedFunction<typeof apiCallOrThrow>

const projects = [
  { id: 'project-1', name: 'Build', code: 'BLD', color: null },
]

function renderTimerBar() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TimerBar projects={projects} staffMemberId="staff-1" onTimerStopped={jest.fn()} />
    </QueryClientProvider>,
  )
}

describe('TimerBar guarded mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } } as any)
    mockApiCallOrThrow.mockResolvedValue({ result: { id: 'entry-1' } } as any)
  })

  it('routes the atomic timer start through guarded mutation context', async () => {
    renderTimerBar()

    fireEvent.click(screen.getByRole('button', { name: 'Project' }))
    fireEvent.click(screen.getByRole('button', { name: /Build/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }))

    await waitFor(() => expect(mockRunMutation).toHaveBeenCalledTimes(1))
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        resourceKind: 'staff.timesheets.time_entry',
        resourceId: 'staff-1',
        staffMemberId: 'staff-1',
        action: 'timer-start',
        retryLastMutation: mockRetryLastMutation,
      }),
      mutationPayload: expect.objectContaining({
        staffMemberId: 'staff-1',
        timeProjectId: 'project-1',
      }),
    }))
    expect(mockApiCallOrThrow).toHaveBeenCalledWith(
      '/api/staff/timesheets/time-entries/start-timer',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('routes timer stop through guarded mutation context', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: {
        items: [{
          id: 'entry-1',
          time_project_id: 'project-1',
          notes: 'Build task',
          started_at: new Date().toISOString(),
          ended_at: null,
        }],
      },
    } as any)

    renderTimerBar()

    fireEvent.click(await screen.findByRole('button', { name: 'Stop timer' }))

    await waitFor(() => expect(mockRunMutation).toHaveBeenCalledTimes(1))
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        resourceKind: 'staff.timesheets.time_entry',
        resourceId: 'entry-1',
        staffMemberId: 'staff-1',
        retryLastMutation: mockRetryLastMutation,
      }),
      mutationPayload: {
        id: 'entry-1',
        action: 'timer-stop',
        staffMemberId: 'staff-1',
      },
    }))
  })
})
