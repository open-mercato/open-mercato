import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import {
  startLazySchedulerSupervisor,
  type LazySchedulerSupervisorProbeFn,
  type LazySchedulerSupervisorSpawnFn,
} from '../scheduler-supervisor'

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

async function flushAsync(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve()
  }
}

describe('startLazySchedulerSupervisor', () => {
  it('does not spawn the scheduler while no enabled schedules exist', async () => {
    const spawnFn = jest.fn() as unknown as jest.MockedFunction<LazySchedulerSupervisorSpawnFn>
    const probeFn = jest.fn(async () => ({
      enabledSchedules: 0,
      dueSchedules: 0,
      error: false,
    })) as jest.MockedFunction<LazySchedulerSupervisorProbeFn>

    const handle = startLazySchedulerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      pollMs: 250,
      restartOnUnexpectedExit: true,
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    expect(probeFn).toHaveBeenCalled()
    expect(spawnFn).not.toHaveBeenCalled()
    expect(handle.started).toBe(false)

    await handle.close()
  })

  it('spawns the existing scheduler command after an enabled schedule appears', async () => {
    const child = createFakeChild()
    const spawnFn = jest.fn(() => child) as unknown as jest.MockedFunction<LazySchedulerSupervisorSpawnFn>
    const probeFn = jest.fn(async () => ({
      enabledSchedules: 1,
      dueSchedules: 0,
      error: false,
    })) as jest.MockedFunction<LazySchedulerSupervisorProbeFn>

    const handle = startLazySchedulerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      pollMs: 250,
      restartOnUnexpectedExit: false,
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)

    expect(spawnFn).toHaveBeenCalledTimes(1)
    const [command, args] = spawnFn.mock.calls[0]
    expect(command).toBe('node')
    expect(args).toEqual(['/tmp/mercato', 'scheduler', 'start'])
    expect(handle.started).toBe(true)

    await flushAsync(20)
    expect(spawnFn).toHaveBeenCalledTimes(1)

    await handle.close()
  })

  it('does not spawn when the probe reports an error', async () => {
    const spawnFn = jest.fn() as unknown as jest.MockedFunction<LazySchedulerSupervisorSpawnFn>
    const probeFn = jest.fn(async () => ({
      enabledSchedules: 0,
      dueSchedules: 0,
      error: true,
      errorMessage: 'database unavailable',
    })) as jest.MockedFunction<LazySchedulerSupervisorProbeFn>

    const handle = startLazySchedulerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      pollMs: 250,
      restartOnUnexpectedExit: true,
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    expect(spawnFn).not.toHaveBeenCalled()

    await handle.close()
  })

  it('terminates the scheduler child on close()', async () => {
    const child = createFakeChild()
    const spawnFn = jest.fn(() => child) as unknown as jest.MockedFunction<LazySchedulerSupervisorSpawnFn>
    const probeFn = jest.fn(async () => ({
      enabledSchedules: 1,
      dueSchedules: 1,
      error: false,
    })) as jest.MockedFunction<LazySchedulerSupervisorProbeFn>

    const handle = startLazySchedulerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      pollMs: 250,
      restartOnUnexpectedExit: true,
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    await handle.close()

    expect((child as any).kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('restarts an unexpectedly exited scheduler only while schedules still exist', async () => {
    const firstChild = createFakeChild()
    const secondChild = createFakeChild()
    const spawnFn = jest
      .fn()
      .mockImplementationOnce(() => firstChild)
      .mockImplementationOnce(() => secondChild) as unknown as jest.MockedFunction<LazySchedulerSupervisorSpawnFn>

    let enabledSchedules = 1
    const probeFn = jest.fn(async () => ({
      enabledSchedules,
      dueSchedules: enabledSchedules,
      error: false,
    })) as jest.MockedFunction<LazySchedulerSupervisorProbeFn>

    const handle = startLazySchedulerSupervisor({
      mercatoBin: '/tmp/mercato',
      appDir: '/tmp/app',
      runtimeEnv: { ...process.env },
      pollMs: 250,
      restartOnUnexpectedExit: true,
      spawnFn,
      probeFn,
      logger: silentLogger,
    })

    await flushAsync(20)
    expect(spawnFn).toHaveBeenCalledTimes(1)

    firstChild.triggerExit(1, null)
    await flushAsync(40)
    expect(spawnFn).toHaveBeenCalledTimes(2)

    enabledSchedules = 0
    secondChild.triggerExit(1, null)
    await flushAsync(40)
    expect(spawnFn).toHaveBeenCalledTimes(2)

    await handle.close()
  })
})
