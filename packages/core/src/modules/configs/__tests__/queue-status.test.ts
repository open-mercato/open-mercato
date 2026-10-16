import { buildQueueStatusSnapshot } from '../lib/queue-status'
import * as registry from '../lib/queue-status-registry'

jest.mock('../lib/queue-status-registry')

const mockListRegisteredQueues = registry.listRegisteredQueues as jest.Mock
const mockResolveStatusQueue = registry.resolveStatusQueue as jest.Mock

function makeQueue(overrides: Record<string, unknown> = {}) {
  return {
    name: 'queue-a',
    strategy: 'async',
    getJobCounts: jest.fn(async () => ({ waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 })),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('buildQueueStatusSnapshot', () => {
  it('enumerates every registered queue and reports counts-only when optional methods are absent', async () => {
    mockListRegisteredQueues.mockReturnValue([{ queue: 'queue-a', workerIds: ['mod:workers:a'], concurrency: 1 }])
    mockResolveStatusQueue.mockReturnValue(makeQueue())

    const snapshot = await buildQueueStatusSnapshot()

    expect(snapshot.queues).toHaveLength(1)
    expect(snapshot.queues[0]).toMatchObject({
      queue: 'queue-a',
      workerIds: ['mod:workers:a'],
      strategy: 'async',
      fidelity: 'exact',
      counts: { waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 },
      failedJobsUnavailable: true,
      inFlightUnavailable: true,
    })
    expect(snapshot.queues[0].failedJobs).toBeUndefined()
  })

  it('marks the local strategy as partial fidelity', async () => {
    mockListRegisteredQueues.mockReturnValue([{ queue: 'queue-a', workerIds: [], concurrency: null }])
    mockResolveStatusQueue.mockReturnValue(makeQueue({ strategy: 'local' }))

    const snapshot = await buildQueueStatusSnapshot()

    expect(snapshot.queues[0].fidelity).toBe('partial')
  })

  it('narrows to a single queue via ?queue= and returns an empty, non-erroring snapshot for an unknown name', async () => {
    mockListRegisteredQueues.mockReturnValue([
      { queue: 'queue-a', workerIds: [], concurrency: null },
      { queue: 'queue-b', workerIds: [], concurrency: null },
    ])
    mockResolveStatusQueue.mockReturnValue(makeQueue())

    const narrowed = await buildQueueStatusSnapshot({ queue: 'queue-a' })
    expect(narrowed.queues.map((q) => q.queue)).toEqual(['queue-a'])
    expect(narrowed.filter.queue).toBe('queue-a')

    const unknown = await buildQueueStatusSnapshot({ queue: 'does-not-exist' })
    expect(unknown.queues).toEqual([])
  })

  it('includes failedJobs, processingStats, and in-flight/aged-waiting when the strategy implements them, and never leaks a payload field anywhere', async () => {
    mockListRegisteredQueues.mockReturnValue([{ queue: 'queue-a', workerIds: [], concurrency: null }])
    mockResolveStatusQueue.mockReturnValue(makeQueue({
      getFailedJobsSummary: jest.fn(async () => ([
        { id: 'f1', queue: 'queue-a', failedReason: 'boom', attemptsMade: 2, failedAt: 123 },
      ])),
      getProcessingStats: jest.fn(async () => ({ sampleSize: 10, avgProcessingMs: 50, fidelity: 'exact' })),
      getInFlightJobsSummary: jest.fn(async (opts: { state: string }) => {
        if (opts.state === 'active') return [{ id: 'a1', queue: 'queue-a', state: 'active', runningMs: 10 }]
        if (opts.state === 'waiting') return [{ id: 'w1', queue: 'queue-a', state: 'waiting', ageMs: 999 }]
        return []
      }),
    }))

    const snapshot = await buildQueueStatusSnapshot()
    const entry = snapshot.queues[0]

    expect(entry.failedJobsUnavailable).toBe(false)
    expect(entry.failedJobs).toHaveLength(1)
    expect(entry.processingStats).toMatchObject({ sampleSize: 10, avgProcessingMs: 50 })
    expect(entry.inFlightUnavailable).toBe(false)
    expect(entry.inFlight).toEqual([expect.objectContaining({ id: 'a1' })])
    expect(entry.agedWaiting).toEqual([expect.objectContaining({ id: 'w1' })])

    // Sanitization assertion: no `data`/payload key anywhere in the snapshot.
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('"data"')
    expect(serialized).not.toContain('payload')
  })

  it('passes the type filter through to processing stats and in-flight summaries', async () => {
    const getProcessingStats = jest.fn(async () => ({ sampleSize: 0 }))
    const getInFlightJobsSummary = jest.fn(async () => [])
    mockListRegisteredQueues.mockReturnValue([{ queue: 'queue-a', workerIds: [], concurrency: null }])
    mockResolveStatusQueue.mockReturnValue(makeQueue({ getProcessingStats, getInFlightJobsSummary }))

    await buildQueueStatusSnapshot({ type: 'job-type-x' })

    expect(getProcessingStats).toHaveBeenCalledWith(expect.objectContaining({ type: 'job-type-x' }))
    expect(getInFlightJobsSummary).toHaveBeenCalledWith(expect.objectContaining({ type: 'job-type-x', state: 'active' }))
  })

  it('does not fail the whole snapshot when one queue throws — it reports that queue with an error', async () => {
    mockListRegisteredQueues.mockReturnValue([
      { queue: 'ok-queue', workerIds: [], concurrency: null },
      { queue: 'broken-queue', workerIds: [], concurrency: null },
    ])
    mockResolveStatusQueue.mockImplementation((name: string) => {
      if (name === 'broken-queue') {
        return makeQueue({
          name,
          getJobCounts: jest.fn(async () => { throw new Error('redis down') }),
        })
      }
      return makeQueue({ name })
    })

    const snapshot = await buildQueueStatusSnapshot()

    expect(snapshot.queues).toHaveLength(2)
    const broken = snapshot.queues.find((q) => q.queue === 'broken-queue')
    expect(broken?.error).toBe('redis down')
    const ok = snapshot.queues.find((q) => q.queue === 'ok-queue')
    expect(ok?.error).toBeUndefined()
  })

  it('echoes canInspectPayloads from the caller', async () => {
    mockListRegisteredQueues.mockReturnValue([])

    const withFeature = await buildQueueStatusSnapshot({ canInspectPayloads: true })
    expect(withFeature.canInspectPayloads).toBe(true)

    const without = await buildQueueStatusSnapshot({})
    expect(without.canInspectPayloads).toBe(false)
  })
})
