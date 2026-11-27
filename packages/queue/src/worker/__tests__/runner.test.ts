import { createQueue } from '../../factory'
import type { Queue } from '../../types'
import { registerWorkerShutdownHook, runWorker } from '../runner'
import { registerWorkerGate, unregisterWorkerGate } from '@open-mercato/shared/lib/runtime/worker-gate'

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
    const shutdownHook = jest.fn(async () => {})
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
    registerWorkerShutdownHook(shutdownHook)

    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermListeners + 1)
    expect(process.listenerCount('SIGINT')).toBe(initialSigintListeners + 1)

    const sigtermHandler = process.listeners('SIGTERM')[initialSigtermListeners] as (() => void) | undefined
    sigtermHandler?.()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(queueA.close).toHaveBeenCalledTimes(1)
    expect(queueB.close).toHaveBeenCalledTimes(1)
    expect(shutdownHook).toHaveBeenCalledTimes(1)
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

  it('parks a job while a worker gate pauses the queue and runs it after resume', async () => {
    const queue = buildFakeQueue('queue-gated')
    createQueueMock.mockReturnValueOnce(queue)
    let paused = true
    const handler = jest.fn(async () => {})
    registerWorkerGate({ id: 'runner-test-gate', shouldPause: (info) => info.queueName === 'queue-gated' && paused })
    try {
      await runWorker({ queueName: 'queue-gated', handler, background: true, gracefulShutdown: false })
      const wrapped = (queue.process as jest.Mock).mock.calls[0][0] as (job: unknown, ctx: unknown) => Promise<void>
      const running = wrapped({ id: 'job-1', payload: {} }, { jobId: 'job-1' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(handler).not.toHaveBeenCalled()
      paused = false
      await running
      expect(handler).toHaveBeenCalledTimes(1)
    } finally {
      unregisterWorkerGate('runner-test-gate')
    }
  })

  it('announces the runner before process() resolves so a parked first batch still heartbeats', async () => {
    const queue = buildFakeQueue('queue-blocked')
    let releaseProcess: () => void = () => {}
    ;(queue.process as jest.Mock).mockImplementation(
      () => new Promise((resolve) => {
        releaseProcess = () => resolve({ processed: -1, failed: -1, lastJobId: undefined })
      }),
    )
    createQueueMock.mockReturnValueOnce(queue)
    const onRunnerStarted = jest.fn()
    registerWorkerGate({ id: 'runner-start-gate', shouldPause: () => false, onRunnerStarted })
    try {
      const running = runWorker({ queueName: 'queue-blocked', handler: async () => {}, background: true, gracefulShutdown: false })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(onRunnerStarted).toHaveBeenCalledWith({ kind: 'worker', queueName: 'queue-blocked' })
      releaseProcess()
      await running
    } finally {
      unregisterWorkerGate('runner-start-gate')
    }
  })
})
