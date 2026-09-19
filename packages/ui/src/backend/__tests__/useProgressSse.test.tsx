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

  // Prior behavior (fixed): idle pages polled /api/progress/active every 5s
  // regardless of whether any job was active. A characterization run against
  // that code (1 mount fetch + 12 polls over 60s = 13 calls) confirmed the
  // defect before this fix landed. The fix degrades the idle cadence to 30s
  // (a reconciliation backstop for a dropped cross-process notify) rather
  // than stopping outright, since the Postgres LISTEN/NOTIFY bridge has no
  // replay for a listener that was mid-reconnect when a job was created.
  it('idle with no active jobs: degrades to the 30s reconciliation cadence', async () => {
    jest.useFakeTimers()
    mockApiCall.mockResolvedValue(mockProgressResponse([]))

    renderHook(() => useProgressSse())

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockApiCall).toHaveBeenCalledTimes(1)

    await act(async () => {
      jest.advanceTimersByTime(60000)
      await Promise.resolve()
    })

    // 1 mount fetch + 2 polls at 30s over 60s = 3.
    expect(mockApiCall).toHaveBeenCalledTimes(3)
  })

  it('while a job is active: keeps polling at the 5s cadence', async () => {
    jest.useFakeTimers()
    mockApiCall.mockResolvedValue(mockProgressResponse([runningJob]))

    renderHook(() => useProgressSse())

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockApiCall).toHaveBeenCalledTimes(1)

    await act(async () => {
      jest.advanceTimersByTime(60000)
      await Promise.resolve()
    })

    // 1 mount fetch + 12 polls at 5s over 60s = 13.
    expect(mockApiCall).toHaveBeenCalledTimes(13)
  })

  it('a progress.job.created event while idle triggers exactly one fetch', async () => {
    mockApiCall.mockResolvedValue(mockProgressResponse([]))
    renderHook(() => useProgressSse())

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))

    act(() => {
      for (const handler of mockAppEventHandlers.get('progress.job.created') ?? []) {
        handler({})
      }
    })

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
  })

  it('unmounting mid-interval stops further fetches', async () => {
    jest.useFakeTimers()
    mockApiCall.mockResolvedValue(mockProgressResponse([runningJob]))

    const { result, unmount } = renderHook(() => useProgressSse())

    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.activeJobs).toHaveLength(1))

    const callsBeforeUnmount = mockApiCall.mock.calls.length
    unmount()

    await act(async () => {
      jest.advanceTimersByTime(60000)
      await Promise.resolve()
    })

    expect(mockApiCall).toHaveBeenCalledTimes(callsBeforeUnmount)
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
