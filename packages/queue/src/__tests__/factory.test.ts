import { resolveQueueStrategy, createModuleQueue } from '../factory'
import { getRedisUrlOrThrow, parseRedisUrl } from '@open-mercato/shared/lib/redis/connection'

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(),
  parseRedisUrl: jest.fn(),
}))

jest.mock('bullmq', () => {
  class MockQueue<T> {
    constructor(_name: string, _opts: unknown) {}
    add = jest.fn(async () => ({ id: 'bull-job-id' }))
    close = jest.fn(async () => {})
    obliterate = jest.fn(async () => {})
    getJobCounts = jest.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 }))
  }

  class MockWorker<T> {
    constructor(_name: string, _processor: unknown, _opts: unknown) {}
    on = jest.fn()
    close = jest.fn(async () => {})
  }

  return { Queue: MockQueue, Worker: MockWorker }
})

describe('resolveQueueStrategy', () => {
  const originalEnv = process.env.QUEUE_STRATEGY

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.QUEUE_STRATEGY
    } else {
      process.env.QUEUE_STRATEGY = originalEnv
    }
  })

  it('returns "local" when QUEUE_STRATEGY is not set', () => {
    delete process.env.QUEUE_STRATEGY
    expect(resolveQueueStrategy()).toBe('local')
  })

  it('returns "local" when QUEUE_STRATEGY is "local"', () => {
    process.env.QUEUE_STRATEGY = 'local'
    expect(resolveQueueStrategy()).toBe('local')
  })

  it('returns "async" when QUEUE_STRATEGY is "async"', () => {
    process.env.QUEUE_STRATEGY = 'async'
    expect(resolveQueueStrategy()).toBe('async')
  })

  it('returns "local" for any unrecognized value', () => {
    process.env.QUEUE_STRATEGY = 'unknown'
    expect(resolveQueueStrategy()).toBe('local')
  })
})

describe('createModuleQueue', () => {
  const originalEnv = process.env.QUEUE_STRATEGY
  const getRedisUrlOrThrowMock = getRedisUrlOrThrow as jest.MockedFunction<typeof getRedisUrlOrThrow>
  const parseRedisUrlMock = parseRedisUrl as jest.MockedFunction<typeof parseRedisUrl>

  beforeEach(() => {
    jest.clearAllMocks()
    getRedisUrlOrThrowMock.mockReturnValue('redis://localhost:6379')
    parseRedisUrlMock.mockReturnValue({ host: 'localhost', port: 6379 })
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.QUEUE_STRATEGY
    } else {
      process.env.QUEUE_STRATEGY = originalEnv
    }
  })

  it('creates a local queue when QUEUE_STRATEGY is not set', () => {
    delete process.env.QUEUE_STRATEGY
    const queue = createModuleQueue('test-queue')
    expect(queue.strategy).toBe('local')
    expect(queue.name).toBe('test-queue')
  })

  it('creates an async queue when QUEUE_STRATEGY is "async"', () => {
    process.env.QUEUE_STRATEGY = 'async'
    const queue = createModuleQueue('test-queue', { concurrency: 5 })
    expect(queue.strategy).toBe('async')
    expect(queue.name).toBe('test-queue')
    expect(getRedisUrlOrThrowMock).toHaveBeenCalledWith('QUEUE')
    expect(parseRedisUrlMock).toHaveBeenCalledWith('redis://localhost:6379')
  })

  it('passes concurrency to local strategy', () => {
    delete process.env.QUEUE_STRATEGY
    const queue = createModuleQueue('test-queue', { concurrency: 3 })
    expect(queue.strategy).toBe('local')
    expect(queue.name).toBe('test-queue')
  })
})
