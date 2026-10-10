const reportErrorMock = jest.fn()
const getJobCountsMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: () => ({
    getJobCounts: () => getJobCountsMock(),
    enqueue: jest.fn(),
    close: jest.fn(),
  }),
}))

import { XRAY_SUGGESTIONS_QUEUE, readXrayIngestBacklog, readXraySuggestionsBacklog } from '../queue'

describe('X-Ray queue backlog reads', () => {
  beforeEach(() => {
    reportErrorMock.mockReset()
    getJobCountsMock.mockReset()
  })

  it('returns the waiting jobs of the queue', async () => {
    getJobCountsMock.mockResolvedValue({ waiting: 7, active: 1, completed: 0, failed: 0 })
    expect(await readXraySuggestionsBacklog()).toBe(7)
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('answers null and reports the failure when the queue cannot tell its backlog', async () => {
    const failure = new Error('[internal] queue unavailable')
    getJobCountsMock.mockRejectedValue(failure)
    expect(await readXraySuggestionsBacklog()).toBeNull()
    expect(await readXrayIngestBacklog()).toBeNull()
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({
      module: 'insights',
      code: 'insights.xray_queue_backlog_failed',
      attributes: { queue: XRAY_SUGGESTIONS_QUEUE },
    }))
    expect(reportErrorMock).toHaveBeenCalledTimes(2)
  })
})
