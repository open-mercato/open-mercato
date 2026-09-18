const enqueueFn = jest.fn(async () => 'job-x')
const processFn = jest.fn(async () => {})
const createModuleQueueMock = jest.fn(() => ({ enqueue: enqueueFn, process: processFn }))

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: (...args: unknown[]) => createModuleQueueMock(...args),
}))

const ORIGINAL_ENV = { ...process.env }

function loadQueueModule() {
  let mod!: typeof import('../queue')
  jest.isolateModules(() => {
    mod = require('../queue')
  })
  return mod
}

beforeEach(() => {
  enqueueFn.mockClear()
  processFn.mockClear()
  createModuleQueueMock.mockClear()
  process.env = { ...ORIGINAL_ENV, QUEUE_STRATEGY: 'async' }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('getPushQueue', () => {
  it('caches one queue instance per queue name', () => {
    const mod = loadQueueModule()
    const first = mod.getPushQueue()
    const second = mod.getPushQueue()
    expect(first).toBe(second)
    expect(createModuleQueueMock).toHaveBeenCalledTimes(1)
    expect(createModuleQueueMock).toHaveBeenCalledWith(mod.PUSH_DELIVERIES_QUEUE, expect.any(Object))
  })

  it('creates separate instances for distinct queue names', () => {
    const mod = loadQueueModule()
    mod.getPushQueue('queue-a')
    mod.getPushQueue('queue-b')
    expect(createModuleQueueMock).toHaveBeenCalledTimes(2)
  })

  it('defaults concurrency to 8 when PUSH_QUEUE_CONCURRENCY is unset', () => {
    delete process.env.PUSH_QUEUE_CONCURRENCY
    const mod = loadQueueModule()
    mod.getPushQueue()
    expect(createModuleQueueMock.mock.calls[0][1]).toEqual({ concurrency: 8 })
  })

  it('honors a valid PUSH_QUEUE_CONCURRENCY value', () => {
    process.env.PUSH_QUEUE_CONCURRENCY = '4'
    const mod = loadQueueModule()
    mod.getPushQueue()
    expect(createModuleQueueMock.mock.calls[0][1]).toEqual({ concurrency: 4 })
  })

  it('falls back to 8 for a non-numeric value', () => {
    process.env.PUSH_QUEUE_CONCURRENCY = 'nope'
    const mod = loadQueueModule()
    mod.getPushQueue()
    expect(createModuleQueueMock.mock.calls[0][1]).toEqual({ concurrency: 8 })
  })

  it('falls back to 8 for a zero value (falsy ⇒ default branch)', () => {
    process.env.PUSH_QUEUE_CONCURRENCY = '0'
    const mod = loadQueueModule()
    mod.getPushQueue()
    expect(createModuleQueueMock.mock.calls[0][1]).toEqual({ concurrency: 8 })
  })

  it('clamps a negative value to a floor of 1', () => {
    process.env.PUSH_QUEUE_CONCURRENCY = '-3'
    const mod = loadQueueModule()
    mod.getPushQueue()
    expect(createModuleQueueMock.mock.calls[0][1]).toEqual({ concurrency: 1 })
  })
})

describe('enqueuePushDelivery', () => {
  const job = { deliveryId: 'del-1', tenantId: 'ten-1', organizationId: null }

  it('enqueues without delay options when no delay is given', async () => {
    const mod = loadQueueModule()
    const jobId = await mod.enqueuePushDelivery(job)
    expect(jobId).toBe('job-x')
    expect(enqueueFn).toHaveBeenCalledWith(job, undefined)
  })

  it('passes a delayMs option when the delay is positive', async () => {
    const mod = loadQueueModule()
    await mod.enqueuePushDelivery(job, 1500)
    expect(enqueueFn).toHaveBeenCalledWith(job, { delayMs: 1500 })
  })

  it('ignores a non-positive delay', async () => {
    const mod = loadQueueModule()
    await mod.enqueuePushDelivery(job, 0)
    expect(enqueueFn).toHaveBeenCalledWith(job, undefined)
  })
})
