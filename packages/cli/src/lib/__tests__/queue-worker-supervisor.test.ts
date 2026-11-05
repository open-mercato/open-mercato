import { EventEmitter } from 'node:events'
import { ChildProcess } from 'node:child_process'
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
  it('accepts lightweight worker descriptors without importing handlers', async () => {
    const spawnFn = jest.fn() as unknown as jest.MockedFunction<LazySupervisorSpawnFn>
    const probeFn = jest.fn(async (queueName, strategy) =>
      emptyProbe(queueName, strategy),
    ) as jest.MockedFunction<LazySupervisorProbeFn>

    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      workers: [
        {
          id: 'events:workers:dispatch',
          moduleId: 'events',
          queue: 'events',
          concurrency: 1,
        },
      ],
      pollMs: 250,
      restartOnUnexpectedExit: true,
      strategy: 'local',
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    expect(probeFn).toHaveBeenCalledWith('events', 'local')
    expect(spawnFn).not.toHaveBeenCalled()

    await handle.close()
  })

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

  it('can start one shared worker for all queues when any queue has ready jobs', async () => {
    const child = createFakeChild()
    const spawnFn = jest.fn(() => child) as unknown as jest.MockedFunction<LazySupervisorSpawnFn>
    const probeFn = jest.fn(async (queueName, strategy) => {
      if (queueName === 'events' || queueName === 'emails') return readyProbe(queueName, strategy)
      return emptyProbe(queueName, strategy)
    }) as jest.MockedFunction<LazySupervisorProbeFn>

    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      workers: [makeWorker('events'), makeWorker('emails'), makeWorker('search')],
      pollMs: 250,
      restartOnUnexpectedExit: false,
      strategy: 'local',
      spawnMode: 'shared',
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)

    expect(spawnFn).toHaveBeenCalledTimes(1)
    const [command, args] = spawnFn.mock.calls[0]
    expect(command).toBe('node')
    expect(args).toEqual(['/tmp/mercato', 'queue', 'worker', '--all'])
    expect(handle.startedQueues.has('events')).toBe(true)
    expect(handle.startedQueues.has('emails')).toBe(true)
    expect(handle.startedQueues.has('search')).toBe(true)
    expect(handle.getActiveChild('events')).toBe(child)
    expect(handle.getActiveChild('emails')).toBe(child)
    expect(handle.getActiveChild('search')).toBe(child)

    await flushAsync(20)
    expect(spawnFn).toHaveBeenCalledTimes(1)

    await handle.close()
    expect((child as any).kill).toHaveBeenCalledWith('SIGTERM')
  })

  it.each(['shared', 'per-queue'] as const)(
    'waits once per child for deferred exits in %s mode across repeated lifecycles',
    async (spawnMode) => {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        const children: ChildProcess[] = []
        const spawnFn = jest.fn(() => {
          const child = new ChildProcess()
          jest.spyOn(child, 'kill').mockReturnValue(true)
          children.push(child)
          return child
        })
        const queueNames = Array.from({ length: 12 }, (_, index) => `queue-${index}`)
        const onChildExit = jest.fn()
        const handle = startLazyWorkerSupervisor({
          mercatoBin: '/tmp/mercato',
          appDir: '/tmp/app',
          runtimeEnv: {},
          workers: queueNames.map((queueName) => makeWorker(queueName)),
          pollMs: 250,
          restartOnUnexpectedExit: true,
          spawnMode,
          spawnFn,
          probeFn: async (queueName, strategy) => readyProbe(queueName, strategy),
          logger: silentLogger,
          onChildExit,
        })

        await flushAsync(20)
        expect(children).toHaveLength(spawnMode === 'shared' ? 1 : 12)
        for (const queueName of queueNames) {
          expect(handle.getActiveChild(queueName)).toBeDefined()
        }
        let closed = false
        const closing = Promise.all([handle.close(), handle.close(), handle.done]).then(() => {
          closed = true
        })
        try {
          for (const child of children) {
            expect(child.listenerCount('exit')).toBe(2)
            expect(child.kill).toHaveBeenCalledTimes(1)
            expect(child.kill).toHaveBeenCalledWith('SIGTERM')
          }
          await flushAsync(20)
          expect(closed).toBe(false)
          for (const child of children.slice(0, -1)) {
            child.emit('exit', 0, null)
          }
          await flushAsync(20)
          expect(closed).toBe(false)
        } finally {
          for (const child of children) {
            if (child.listenerCount('exit') > 1) child.emit('exit', 0, null)
          }
          await closing
        }
        expect(closed).toBe(true)
        expect(onChildExit).toHaveBeenCalledTimes(12)
        expect(handle.startedQueues.size).toBe(12)
        for (const queueName of queueNames) {
          expect(handle.getActiveChild(queueName)).toBeUndefined()
        }
        await handle.close()
        for (const child of children) {
          expect(child.listenerCount('exit')).toBe(1)
          expect(child.kill).toHaveBeenCalledTimes(1)
        }
        expect(spawnFn).toHaveBeenCalledTimes(spawnMode === 'shared' ? 1 : 12)
      }
    },
  )

  it.each([
    { exitCode: 0, signalCode: null },
    { exitCode: null, signalCode: 'SIGTERM' },
  ])('does not wait for an already-exited shared child (%j)', async (exitState) => {
    const child = new ChildProcess()
    const kill = jest.spyOn(child, 'kill').mockReturnValue(true)
    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: {},
      workers: Array.from({ length: 12 }, (_, index) => makeWorker(`queue-${index}`)),
      pollMs: 250,
      restartOnUnexpectedExit: false,
      spawnMode: 'shared',
      spawnFn: () => child,
      probeFn: async (queueName, strategy) => readyProbe(queueName, strategy),
      logger: silentLogger,
    })
    await flushAsync(20)
    Object.assign(child, exitState)

    await handle.close()
    await handle.done
    expect(child.listenerCount('exit')).toBe(1)
    expect(kill).toHaveBeenCalledTimes(1)
    expect(handle.getActiveChild('queue-0')).toBeUndefined()
  })

  it('keeps shutdown waiters bounded after repeated unexpected shared-worker restarts', async () => {
    const children: ChildProcess[] = []
    const spawnFn = jest.fn(() => {
      const child = new ChildProcess()
      jest.spyOn(child, 'kill').mockReturnValue(true)
      children.push(child)
      return child
    })
    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: {},
      workers: Array.from({ length: 12 }, (_, index) => makeWorker(`queue-${index}`)),
      pollMs: 250,
      restartOnUnexpectedExit: true,
      spawnMode: 'shared',
      spawnFn,
      probeFn: async (queueName, strategy) => readyProbe(queueName, strategy),
      logger: silentLogger,
    })
    await flushAsync(40)
    for (const restart of [0, 1, 2]) {
      const child = children[restart]
      expect(child.listenerCount('exit')).toBe(1)
      Object.assign(child, { exitCode: 1 })
      child.emit('exit', 1, null)
      await flushAsync(100)
      expect(spawnFn).toHaveBeenCalledTimes(restart + 2)
      expect(child.kill).not.toHaveBeenCalled()
      expect(handle.getActiveChild('queue-0')).toBe(children[restart + 1])
    }
    const lastChild = children[3]
    const closing = handle.close()
    try {
      expect(lastChild.listenerCount('exit')).toBe(2)
      expect(lastChild.kill).toHaveBeenCalledTimes(1)
    } finally {
      lastChild.emit('exit', null, 'SIGTERM')
      await closing
    }
    await flushAsync(40)
    expect(spawnFn).toHaveBeenCalledTimes(4)
    for (const child of children) expect(child.listenerCount('exit')).toBe(1)
  })

  it('starts the shared worker with extra arguments when an embedded scheduler needs it', async () => {
    const child = createFakeChild()
    const spawnFn = jest.fn(() => child) as unknown as jest.MockedFunction<LazySupervisorSpawnFn>
    const probeFn = jest.fn(async (queueName, strategy) =>
      emptyProbe(queueName, strategy),
    ) as jest.MockedFunction<LazySupervisorProbeFn>
    const shouldStartSharedWorker = jest.fn(async () => true)

    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      workers: [makeWorker('events')],
      pollMs: 250,
      restartOnUnexpectedExit: false,
      strategy: 'local',
      spawnMode: 'shared',
      sharedWorkerArgs: ['--with-scheduler'],
      shouldStartSharedWorker,
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)

    expect(shouldStartSharedWorker).toHaveBeenCalled()
    expect(spawnFn).toHaveBeenCalledTimes(1)
    expect(spawnFn.mock.calls[0][1]).toEqual([
      '/tmp/mercato',
      'queue',
      'worker',
      '--all',
      '--with-scheduler',
    ])
    expect(silentLogger.log).toHaveBeenCalledWith(
      '[lazy-supervisor] Enabled schedule detected — starting shared worker for all queues',
    )

    await handle.close()
  })

  it('restarts the shared worker when an embedded scheduler remains enabled', async () => {
    const firstChild = createFakeChild()
    const secondChild = createFakeChild()
    const spawnFn = jest
      .fn()
      .mockImplementationOnce(() => firstChild)
      .mockImplementationOnce(() => secondChild) as unknown as jest.MockedFunction<LazySupervisorSpawnFn>
    const probeFn = jest.fn(async (queueName, strategy) =>
      emptyProbe(queueName, strategy),
    ) as jest.MockedFunction<LazySupervisorProbeFn>
    const shouldStartSharedWorker = jest.fn(async () => true)
    const shouldRestartSharedWorker = jest.fn(async () => true)

    const handle = startLazyWorkerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      workers: [makeWorker('events')],
      pollMs: 250,
      restartOnUnexpectedExit: true,
      strategy: 'local',
      spawnMode: 'shared',
      sharedWorkerArgs: ['--with-scheduler'],
      shouldStartSharedWorker,
      shouldRestartSharedWorker,
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    expect(spawnFn).toHaveBeenCalledTimes(1)

    firstChild.triggerExit(1)
    await flushAsync(40)

    expect(shouldRestartSharedWorker).toHaveBeenCalled()
    expect(spawnFn).toHaveBeenCalledTimes(2)
    expect(spawnFn.mock.calls[1][1]).toEqual([
      '/tmp/mercato',
      'queue',
      'worker',
      '--all',
      '--with-scheduler',
    ])

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
