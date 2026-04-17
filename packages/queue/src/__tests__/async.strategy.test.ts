import { createQueue } from '../factory'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'

const queueCtor = jest.fn()
const workerCtor = jest.fn()
const queueAdd = jest.fn(async () => ({ id: 'bull-job-id' }))
const queueClose = jest.fn(async () => {})
const queueObliterate = jest.fn(async () => {})
const queueGetJobCounts = jest.fn(async () => ({
  waiting: 2,
  active: 1,
  completed: 3,
  failed: 4,
}))
const workerClose = jest.fn(async () => {})
const workerOn = jest.fn()

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(),
}))

jest.mock('bullmq', () => {
  class MockQueue<T> {
    constructor(name: string, opts: unknown) {
      queueCtor(name, opts)
    }

    add = queueAdd as unknown as (name: string, data: T, opts?: unknown) => Promise<{ id?: string }>
    close = queueClose
    obliterate = queueObliterate
    getJobCounts = queueGetJobCounts
  }

  class MockWorker<T> {
    constructor(
      name: string,
      processor: (job: { id?: string; data: T; attemptsMade: number }) => Promise<void>,
      opts: unknown,
    ) {
      workerCtor(name, processor, opts)
    }

    on = workerOn
    close = workerClose
  }

  return {
    Queue: MockQueue,
    Worker: MockWorker,
  }
})

describe('Queue - async strategy', () => {
  const getRedisUrlOrThrowMock = getRedisUrlOrThrow as jest.MockedFunction<typeof getRedisUrlOrThrow>

  beforeEach(() => {
    jest.clearAllMocks()
    getRedisUrlOrThrowMock.mockReturnValue('rediss://default:secret@example.com:6380/1')
  })

  it('passes the full Redis URL to BullMQ when using env-based async config', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'async', {
      concurrency: 3,
    })

    await queue.enqueue({ value: 42 })
    await queue.process(async () => {})

    expect(queueCtor).toHaveBeenCalledWith('test-queue', {
      connection: { url: 'rediss://default:secret@example.com:6380/1' },
    })
    expect(workerCtor).toHaveBeenCalledWith(
      'test-queue',
      expect.any(Function),
      {
        connection: { url: 'rediss://default:secret@example.com:6380/1' },
        concurrency: 3,
      },
    )
  })

  it('preserves an explicit Redis URL without converting it to host/port fields', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'async', {
      connection: {
        url: 'rediss://user:secret@example.com:6380/4?family=6',
      },
    })

    await queue.enqueue({ value: 42 })

    expect(queueCtor).toHaveBeenCalledWith('test-queue', {
      connection: { url: 'rediss://user:secret@example.com:6380/4?family=6' },
    })
  })

  it('enqueues jobs with retry attempts and exponential backoff', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'async')

    await queue.enqueue({ value: 42 })

    expect(queueAdd).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ payload: { value: 42 } }),
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      }),
    )

    await queue.close()
  })

  it('keeps structured Redis options when host-based config is used', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'async', {
      connection: {
        host: 'redis.internal',
        port: 6380,
        username: 'default',
        password: 'secret',
        db: 6,
        tls: {},
      },
    })

    await queue.enqueue({ value: 42 })

    expect(queueCtor).toHaveBeenCalledWith('test-queue', {
      connection: {
        host: 'redis.internal',
        port: 6380,
        username: 'default',
        password: 'secret',
        db: 6,
        tls: {},
      },
    })
  })
})
