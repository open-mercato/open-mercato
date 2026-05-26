import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type { ModuleWorker } from '@open-mercato/shared/modules/registry'
import {
  startLazyWorkerSupervisor,
  type LazySupervisorProbeFn,
  type LazySupervisorSpawnFn,
} from '../queue-worker-supervisor'
import type {
  QueuePendingProbeResult,
  QueueStrategyType,
} from '@open-mercato/queue'

type FakeChild = ChildProcess & {
  triggerExit: (code: number | null, signal?: NodeJS.Signals | null) => void
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as unknown as FakeChild
  ;(child as any).stdout = null
  ;(child as any).stderr = null
  ;(child as any).pid = Math.floor(Math.random() * 100000) + 1
  ;(child as any).killed = false
  ;(child as any).exitCode = null
  ;(child as any).signalCode = null
  ;(child as any).kill = jest.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    if ((child as any).killed) return true
    ;(child as any).killed = true
    ;(child as any).signalCode = signal
    process.nextTick(() => child.emit('exit', null, signal))
    return true
  })
  child.triggerExit = (code, signal = null) => {
    ;(child as any).exitCode = code
    ;(child as any).signalCode = signal
    child.emit('exit', code, signal)
  }
  return child
}

const silentLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() }

function makeWorker(queue: string, id?: string, concurrency = 1): ModuleWorker {
  return {
    id: id ?? `${queue}-worker`,
    queue,
    concurrency,
    handler: jest.fn() as unknown as ModuleWorker['handler'],
  }
}

function emptyProbe(queueName: string, strategy: QueueStrategyType): QueuePendingProbeResult {
  return { queueName, strategy, ready: 0, delayedFuture: 0, active: 0, error: false }
}

function readyProbe(queueName: string, strategy: QueueStrategyType, ready = 1): QueuePendingProbeResult {
  return { queueName, strategy, ready, delayedFuture: 0, active: 0, error: false }
}

async function flushAsync(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve()
  }
}

describe('startLazyWorkerSupervisor', () => {
  it('does not spawn any worker while every queue is idle', async () => {
    const spawnFn = jest.fn() as unknown as jest.MockedFunction<LazySupervisorSpawnFn>
    const probeFn = jest.fn(async (queueName, strategy) =>
      emptyProbe(queueName, strategy),
    ) as jest.MockedFunction<LazySupervisorProbeFn>

    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      workers: [makeWorker('events'), makeWorker('emails')],
      pollMs: 250,
      restartOnUnexpectedExit: true,
      strategy: 'local',
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    expect(probeFn).toHaveBeenCalled()
    expect(spawnFn).not.toHaveBeenCalled()
    expect(handle.startedQueues.size).toBe(0)

    await handle.close()
  })

  it('spawns only the queue with ready jobs and never duplicates the spawn', async () => {
    const child = createFakeChild()
    const spawnFn = jest.fn(() => child) as unknown as jest.MockedFunction<LazySupervisorSpawnFn>
    const probeFn = jest.fn(async (queueName, strategy) => {
      if (queueName === 'events') return readyProbe(queueName, strategy)
      return emptyProbe(queueName, strategy)
    }) as jest.MockedFunction<LazySupervisorProbeFn>

    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      workers: [makeWorker('events'), makeWorker('emails')],
      pollMs: 250,
      restartOnUnexpectedExit: false,
      strategy: 'local',
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)

    expect(spawnFn).toHaveBeenCalledTimes(1)
    const [command, args] = spawnFn.mock.calls[0]
    expect(command).toBe('node')
    expect(args).toEqual(['/tmp/mercato', 'queue', 'worker', 'events'])
    expect(handle.startedQueues.has('events')).toBe(true)
    expect(handle.startedQueues.has('emails')).toBe(false)

    await flushAsync(20)
    expect(spawnFn).toHaveBeenCalledTimes(1)

    await handle.close()
  })

  it('does not spawn when probe reports an error', async () => {
    const spawnFn = jest.fn() as unknown as jest.MockedFunction<LazySupervisorSpawnFn>
    const probeFn = jest.fn(async (queueName, strategy) => ({
      queueName,
      strategy,
      ready: 0,
      delayedFuture: 0,
      active: 0,
      error: true,
      errorMessage: 'redis-unreachable',
    })) as jest.MockedFunction<LazySupervisorProbeFn>

    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      workers: [makeWorker('events')],
      pollMs: 250,
      restartOnUnexpectedExit: false,
      strategy: 'async',
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    expect(spawnFn).not.toHaveBeenCalled()

    await handle.close()
  })

  it('terminates active children on close()', async () => {
    const child = createFakeChild()
    const spawnFn = jest.fn(() => child) as unknown as jest.MockedFunction<LazySupervisorSpawnFn>
    const probeFn = jest.fn(async (queueName, strategy) =>
      readyProbe(queueName, strategy),
    ) as jest.MockedFunction<LazySupervisorProbeFn>

    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      workers: [makeWorker('events')],
      pollMs: 250,
      restartOnUnexpectedExit: false,
      strategy: 'local',
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    expect(spawnFn).toHaveBeenCalledTimes(1)

    await handle.close()
    expect((child as any).kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('restarts an unexpectedly exited worker only when jobs remain pending', async () => {
    const firstChild = createFakeChild()
    const secondChild = createFakeChild()
    const spawnFn = jest
      .fn()
      .mockImplementationOnce(() => firstChild)
      .mockImplementationOnce(() => secondChild) as unknown as jest.MockedFunction<LazySupervisorSpawnFn>

    let pendingReady = 1
    const probeFn = jest.fn(async (queueName, strategy) => {
      if (queueName !== 'events') return emptyProbe(queueName, strategy)
      return readyProbe(queueName, strategy, pendingReady)
    }) as jest.MockedFunction<LazySupervisorProbeFn>

    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      workers: [makeWorker('events')],
      pollMs: 250,
      restartOnUnexpectedExit: true,
      strategy: 'local',
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    expect(spawnFn).toHaveBeenCalledTimes(1)

    // Worker dies unexpectedly with jobs still pending — supervisor must restart.
    firstChild.triggerExit(1, null)
    await flushAsync(40)
    expect(spawnFn).toHaveBeenCalledTimes(2)

    // Worker dies again, but this time no jobs remain — supervisor must NOT restart.
    pendingReady = 0
    secondChild.triggerExit(1, null)
    await flushAsync(40)
    expect(spawnFn).toHaveBeenCalledTimes(2)

    await handle.close()
  })

  it('does not restart on an expected SIGTERM exit', async () => {
    const child = createFakeChild()
    const spawnFn = jest.fn(() => child) as unknown as jest.MockedFunction<LazySupervisorSpawnFn>
    const probeFn = jest.fn(async (queueName, strategy) =>
      readyProbe(queueName, strategy),
    ) as jest.MockedFunction<LazySupervisorProbeFn>

    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      workers: [makeWorker('events')],
      pollMs: 250,
      restartOnUnexpectedExit: true,
      strategy: 'local',
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    expect(spawnFn).toHaveBeenCalledTimes(1)

    child.triggerExit(null, 'SIGTERM')
    await flushAsync(40)

    expect(spawnFn).toHaveBeenCalledTimes(1)

    await handle.close()
  })

  it('handles an empty worker list without crashing', async () => {
    const spawnFn = jest.fn() as unknown as jest.MockedFunction<LazySupervisorSpawnFn>
    const probeFn = jest.fn() as unknown as jest.MockedFunction<LazySupervisorProbeFn>
    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      workers: [],
      pollMs: 250,
      restartOnUnexpectedExit: true,
      strategy: 'local',
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    expect(probeFn).not.toHaveBeenCalled()
    expect(spawnFn).not.toHaveBeenCalled()
    await handle.close()
  })
})
