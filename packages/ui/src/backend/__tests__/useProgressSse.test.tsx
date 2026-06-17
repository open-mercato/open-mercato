import { act, renderHook, waitFor } from '@testing-library/react'
import type { ProgressJobDto } from '../progress/useProgressPoll'

const mockApiCall = jest.fn()
jest.mock('../utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

const mockAppEventHandlers = new Map<string, Array<(event: { payload?: unknown }) => void>>()
jest.mock('../injection/useAppEvent', () => ({
  useAppEvent: (eventId: string, handler: (event: { payload?: unknown }) => void) => {
    const handlers = mockAppEventHandlers.get(eventId) ?? []
    handlers.push(handler)
    mockAppEventHandlers.set(eventId, handlers)
  },
}))

jest.mock('@open-mercato/shared/lib/frontend/progressEvents', () => ({
  subscribeProgressUpdate: jest.fn(() => jest.fn()),
}))

import { useProgressSse } from '../progress/useProgressSse'

const runningJob: ProgressJobDto = {
  id: 'job-1',
  jobType: 'search.reindex.vector',
  name: 'Search vector reindex',
  description: 'Vector reindex catalog:catalog_product_variant (queued)',
  status: 'running',
  progressPercent: 0,
  processedCount: 0,
  totalCount: 0,
  cancellable: true,
  startedAt: '2026-06-15T16:37:01.382Z',
  finishedAt: null,
  errorMessage: null,
}

const completedJob: ProgressJobDto = {
  ...runningJob,
  status: 'completed',
  progressPercent: 100,
  finishedAt: '2026-06-15T16:37:01.391Z',
}

function mockProgressResponse(active: ProgressJobDto[], recentlyCompleted: ProgressJobDto[] = []) {
  return {
    ok: true,
    result: {
      active,
      recentlyCompleted,
    },
  }
}

describe('useProgressSse', () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
    mockAppEventHandlers.clear()
  })

  it('removes a job from activeJobs when an SSE update carries a terminal status', async () => {
    mockApiCall.mockResolvedValue(mockProgressResponse([runningJob]))
    const { result } = renderHook(() => useProgressSse())

    await waitFor(() => expect(result.current.activeJobs).toHaveLength(1))

    act(() => {
      for (const handler of mockAppEventHandlers.get('progress.job.updated') ?? []) {
        handler({ payload: { ...completedJob, jobId: completedJob.id } })
      }
    })

    expect(result.current.activeJobs).toHaveLength(0)
    expect(result.current.recentlyCompleted[0]).toEqual(expect.objectContaining({
      id: 'job-1',
      status: 'completed',
    }))
  })

  it('periodically reconciles active jobs in SSE mode when completion events are missed', async () => {
    jest.useFakeTimers()
    mockApiCall
      .mockResolvedValueOnce(mockProgressResponse([runningJob]))
      .mockResolvedValueOnce(mockProgressResponse([], [completedJob]))

    const { result } = renderHook(() => useProgressSse())

    await waitFor(() => expect(result.current.activeJobs).toHaveLength(1))

    await act(async () => {
      jest.advanceTimersByTime(5000)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.activeJobs).toHaveLength(0)
      expect(result.current.recentlyCompleted[0]).toEqual(expect.objectContaining({
        id: 'job-1',
        status: 'completed',
      }))
    })
  })
})
