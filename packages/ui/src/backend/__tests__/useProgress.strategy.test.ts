import type { UseProgressPollResult } from '@open-mercato/ui/backend/progress/useProgressPoll'

const pollResult: UseProgressPollResult = {
  activeJobs: [],
  recentlyCompleted: [],
  isLoading: false,
  error: null,
  refresh: () => undefined,
}

const sseResult: UseProgressPollResult = {
  ...pollResult,
  activeJobs: [
    {
      id: 'job-1',
      jobType: 'search.reindex.fulltext',
      name: 'Search fulltext reindex',
      status: 'running',
      progressPercent: 10,
      processedCount: 1,
      totalCount: 10,
      cancellable: true,
    },
  ],
}

jest.mock('@open-mercato/ui/backend/progress/useProgressPoll', () => ({
  useProgressPoll: jest.fn(() => pollResult),
}))

jest.mock('@open-mercato/ui/backend/progress/useProgressSse', () => ({
  useProgressSse: jest.fn(() => sseResult),
}))

describe('useProgress strategy', () => {
  const originalEventSource = globalThis.window?.EventSource

  afterEach(() => {
    jest.resetModules()
    if (typeof originalEventSource === 'undefined') {
      delete (window as unknown as { EventSource?: typeof EventSource }).EventSource
    } else {
      ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = originalEventSource
    }
  })

  it('uses SSE strategy when EventSource is available', async () => {
    ;(window as unknown as { EventSource?: typeof EventSource }).EventSource = function EventSourceMock() {
      return {} as EventSource
    } as unknown as typeof EventSource

    const { useProgress } = await import('@open-mercato/ui/backend/progress/useProgress')
    expect(useProgress()).toBe(sseResult)
  })

  it('falls back to polling strategy when EventSource is unavailable', async () => {
    delete (window as unknown as { EventSource?: typeof EventSource }).EventSource

    const { useProgress } = await import('@open-mercato/ui/backend/progress/useProgress')
    expect(useProgress()).toBe(pollResult)
  })
})
