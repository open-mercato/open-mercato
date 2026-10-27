import path from 'node:path'
import { createQueue, getQueuePendingProbe } from '@open-mercato/queue'
import { drainIntegrationQueue } from '../queue'

const mockDrainQueue = jest.fn()
const mockRunnerLoaded = jest.fn()

jest.mock('@open-mercato/queue', () => ({ createQueue: jest.fn(), getQueuePendingProbe: jest.fn() }))
jest.mock('../queue-runner', () => {
  mockRunnerLoaded()
  return { drainQueueFromAppRoot: mockDrainQueue }
})

type Counts = { waiting: number; active: number; completed: number; failed: number }

function counts(overrides: Partial<Counts> = {}): Counts {
  return { waiting: 0, active: 0, completed: 0, failed: 0, ...overrides }
}

describe('drainIntegrationQueue', () => {
  const originalEnvironment = { ...process.env }
  const getJobCounts = jest.fn<Promise<Counts>, []>()
  const close = jest.fn<Promise<void>, []>()

  beforeEach(() => {
    jest.clearAllMocks()
    getJobCounts.mockReset()
    delete process.env.OM_TEST_APP_ROOT
    delete process.env.AUTO_SPAWN_WORKERS
    delete process.env.OM_AUTO_SPAWN_WORKERS
    process.env.QUEUE_BASE_DIR = '/tmp/integration-queue-test'
    close.mockResolvedValue(undefined)
    jest.mocked(getQueuePendingProbe).mockReset().mockResolvedValue({ queueName: 'events', strategy: 'local', ready: 0, active: 0, delayedFuture: 0, error: false })
    jest.mocked(createQueue).mockReturnValue({ getJobCounts, close } as never)
  })

  afterEach(() => { process.env = { ...originalEnvironment } })

  it('waits for the existing worker to finish queued and active jobs without bootstrapping another consumer', async () => {
    getJobCounts.mockResolvedValueOnce(counts({ waiting: 1, completed: 4 }))
      .mockResolvedValue(counts({ completed: 5 }))
    jest.mocked(getQueuePendingProbe)
      .mockResolvedValueOnce({ queueName: 'events', strategy: 'local', ready: 1, active: 0, delayedFuture: 0, error: false })
      .mockResolvedValueOnce({ queueName: 'events', strategy: 'local', ready: 0, active: 1, delayedFuture: 0, error: false })
    await expect(drainIntegrationQueue('events')).resolves.toBe(1)
    expect(mockDrainQueue).not.toHaveBeenCalled()
    expect(mockRunnerLoaded).not.toHaveBeenCalled()
    expect(createQueue).toHaveBeenCalledWith('events', 'local', { baseDir: '/tmp/integration-queue-test' })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('returns completed failures for callers to inspect instead of rejecting expected failed jobs', async () => {
    getJobCounts.mockResolvedValueOnce(counts({ waiting: 1, failed: 2 }))
      .mockResolvedValue(counts({ failed: 3 }))
    await expect(drainIntegrationQueue('events')).resolves.toBe(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(mockDrainQueue).not.toHaveBeenCalled()
  })

  it('does not wait for scheduled future jobs that an explicit drain would leave queued', async () => {
    getJobCounts.mockResolvedValue(counts({ waiting: 1 }))
    jest.mocked(getQueuePendingProbe).mockResolvedValue({
      queueName: 'events', strategy: 'local', ready: 0, active: 0, delayedFuture: 1, error: false,
    })
    await expect(drainIntegrationQueue('events')).resolves.toBe(0)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('rejects unavailable queue storage rather than treating it as idle', async () => {
    getJobCounts.mockResolvedValue(counts())
    jest.mocked(getQueuePendingProbe).mockResolvedValue({
      queueName: 'events', strategy: 'local', ready: 0, active: 0, delayedFuture: 0, error: true, errorMessage: 'unreadable',
    })
    await expect(drainIntegrationQueue('events')).rejects.toThrow('Cannot observe integration queue events: unreadable')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it.each(['false', 'off', '0'])('drains in the current process when automatic workers are %s', async (value) => {
    process.env.AUTO_SPAWN_WORKERS = value
    mockDrainQueue.mockResolvedValue(3)
    await expect(drainIntegrationQueue('events', { appRoot: '/tmp/test-app', jobLimit: 7 })).resolves.toBe(3)
    expect(mockDrainQueue).toHaveBeenCalledWith('events', { appRoot: path.resolve('/tmp/test-app'), jobLimit: 7 })
    expect(createQueue).not.toHaveBeenCalled()
  })

  it('honors the automatic worker alias while the legacy setting takes precedence', async () => {
    process.env.OM_AUTO_SPAWN_WORKERS = 'false'
    mockDrainQueue.mockResolvedValue(2)
    await expect(drainIntegrationQueue('events')).resolves.toBe(2)
    process.env.AUTO_SPAWN_WORKERS = 'true'
    getJobCounts.mockResolvedValue(counts())
    await expect(drainIntegrationQueue('events')).resolves.toBe(0)
    expect(mockDrainQueue).toHaveBeenCalledTimes(1)
  })
})
