import { createQueue } from '../../factory'
import type { Queue } from '../../types'
import { runWorker } from '../runner'

jest.mock('../../factory', () => ({
  createQueue: jest.fn(),
}))

function buildFakeQueue(name: string): Queue<unknown> {
  return {
    name,
    strategy: 'local',
    enqueue: jest.fn(async () => 'job-id'),
    process: jest.fn(async () => ({ processed: -1, failed: -1, lastJobId: undefined })),
    clear: jest.fn(async () => ({ removed: 0 })),
    close: jest.fn(async () => {}),
    getJobCounts: jest.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 })),
  }
}

describe('runWorker', () => {
  const createQueueMock = createQueue as jest.MockedFunction<typeof createQueue>

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('registers SIGINT/SIGTERM shutdown handlers only once and closes all queues', async () => {
    const queueA = buildFakeQueue('queue-a')
    const queueB = buildFakeQueue('queue-b')
    createQueueMock.mockReturnValueOnce(queueA).mockReturnValueOnce(queueB)

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const initialSigtermListeners = process.listenerCount('SIGTERM')
    const initialSigintListeners = process.listenerCount('SIGINT')

    await runWorker({
      queueName: 'queue-a',
      handler: async () => {},
      background: true,
      gracefulShutdown: true,
    })

    await runWorker({
      queueName: 'queue-b',
      handler: async () => {},
      background: true,
      gracefulShutdown: true,
    })

    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermListeners + 1)
    expect(process.listenerCount('SIGINT')).toBe(initialSigintListeners + 1)

    const sigtermHandler = process.listeners('SIGTERM')[initialSigtermListeners] as (() => void) | undefined
    sigtermHandler?.()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(queueA.close).toHaveBeenCalledTimes(1)
    expect(queueB.close).toHaveBeenCalledTimes(1)
    expect(exitSpy).toHaveBeenCalledWith(0)
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermListeners)
    expect(process.listenerCount('SIGINT')).toBe(initialSigintListeners)

    exitSpy.mockRestore()
  })

  it('does not register shutdown handlers when gracefulShutdown is disabled', async () => {
    createQueueMock.mockReturnValueOnce(buildFakeQueue('queue-c'))

    const initialSigtermListeners = process.listenerCount('SIGTERM')
    const initialSigintListeners = process.listenerCount('SIGINT')

    await runWorker({
      queueName: 'queue-c',
      handler: async () => {},
      background: true,
      gracefulShutdown: false,
    })

    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermListeners)
    expect(process.listenerCount('SIGINT')).toBe(initialSigintListeners)
  })
})
