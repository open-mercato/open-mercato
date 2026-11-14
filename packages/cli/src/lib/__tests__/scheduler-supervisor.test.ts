import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import {
  startLazySchedulerSupervisor,
  probeEnabledSchedules,
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


const probeConnect = jest.fn()
const probeQuery = jest.fn()
const probeEnd = jest.fn()
const probeReady = jest.fn()
const probeDispose = jest.fn()
const probeRelease = jest.fn()
const configureProbePool = jest.fn()
const probeFreshContext = jest.fn((_context: unknown, callback: () => unknown) => callback())
const probeEnabled = jest.fn(() => false)
const probeUrl = jest.fn((_purpose: string, fallback: string) => fallback)

jest.mock('pg', () => ({ Client: jest.fn(() => ({ connect: probeConnect, query: probeQuery, end: probeEnd })) }))
jest.mock('@open-mercato/shared/lib/db/runtime', () => ({
  isDatabaseRuntimeEnabled: () => probeEnabled(),
  resolveDatabaseConnectionUrl: (purpose: string, fallback: string) => probeUrl(purpose, fallback),
  runWithFreshDatabaseExecutionContext: (context: unknown, callback: () => unknown) => probeFreshContext(context, callback),
  configureDatabasePool: (pool: unknown, descriptor: unknown) => configureProbePool(pool, descriptor),
}))

describe('probeEnabledSchedules database boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    probeEnabled.mockReturnValue(true)
    probeUrl.mockReturnValue('postgresql://maintenance@localhost/disposable')
    probeConnect.mockResolvedValue(undefined)
    probeEnd.mockResolvedValue(undefined)
    probeReady.mockResolvedValue(undefined)
    probeQuery.mockResolvedValue({ rows: [{ enabled_schedules: '3', due_schedules: 1 }] })
    configureProbePool.mockImplementation((pool: { connect: () => Promise<unknown> }) => {
      pool.connect = async () => ({ query: probeQuery, release: probeRelease })
      return { ready: probeReady, dispose: probeDispose }
    })
  })

  it('selects maintenance URL and awaits the supported pool verifier before querying', async () => {
    const result = await probeEnabledSchedules({ DATABASE_URL: 'postgresql://runtime@localhost/disposable' })
    expect(result).toEqual({ enabledSchedules: 3, dueSchedules: 1, error: false })
    expect(probeUrl).toHaveBeenCalledWith('maintenance', 'postgresql://runtime@localhost/disposable')
    expect(require('pg').Client).toHaveBeenCalledWith(expect.objectContaining({ connectionString: 'postgresql://maintenance@localhost/disposable' }))
    expect(probeFreshContext).toHaveBeenCalledWith({ kind: 'maintenance', tenantId: null, source: 'scheduler', operation: 'scheduler.lazy-probe' }, expect.any(Function))
    expect(configureProbePool).toHaveBeenCalledWith(expect.any(Object), { id: 'scheduler-lazy-probe', purpose: 'maintenance', tables: ['scheduled_jobs'] })
    expect(probeReady.mock.invocationCallOrder[0]).toBeLessThan(probeQuery.mock.invocationCallOrder[0])
    expect(probeRelease).toHaveBeenCalledTimes(1)
    expect(probeEnd).toHaveBeenCalledTimes(1)
    expect(probeDispose).toHaveBeenCalledTimes(1)
  })

  it('refuses discovery when maintenance role verification fails and cleans up', async () => {
    probeReady.mockRejectedValue(new Error('unsafe maintenance role'))
    const result = await probeEnabledSchedules({ DATABASE_URL: 'runtime' })
    expect(result).toMatchObject({ error: true, errorMessage: 'unsafe maintenance role' })
    expect(probeQuery).not.toHaveBeenCalled()
    expect(probeRelease).not.toHaveBeenCalled()
    expect(probeEnd).toHaveBeenCalledTimes(1)
    expect(probeDispose).toHaveBeenCalledTimes(1)
  })

  it('allocates and disposes a separate probe lifecycle for every occurrence', async () => {
    await probeEnabledSchedules({ DATABASE_URL: 'runtime' })
    await probeEnabledSchedules({ DATABASE_URL: 'runtime' })
    expect(configureProbePool).toHaveBeenCalledTimes(2)
    expect(configureProbePool.mock.calls[0][0]).not.toBe(configureProbePool.mock.calls[1][0])
    expect(probeFreshContext).toHaveBeenCalledTimes(2)
    expect(probeDispose).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('drains the actual guarded probe pool after query failure=%s', async (queryFails) => {
    const { installTenantPoolBoundary } = jest.requireActual<typeof import('../../../../enterprise/src/lib/rls/runtime/pool')>('../../../../enterprise/src/lib/rls/runtime/pool')
    const { runWithFreshTenantBoundary } = jest.requireActual<typeof import('../../../../enterprise/src/lib/rls/runtime/scope')>('../../../../enterprise/src/lib/rls/runtime/scope')
    probeFreshContext.mockImplementation((context, callback) => runWithFreshTenantBoundary(context as import('@open-mercato/shared/lib/db/runtime').DatabaseExecutionContext, callback))
    configureProbePool.mockImplementation((pool: import('../../../../enterprise/src/lib/rls/runtime/pool').BoundaryPool) => {
      expect(pool.ended).toBe(false)
      const lifecycle = installTenantPoolBoundary(pool, { configurationKey: 'scheduler-probe-regression' })
      return { ready: lifecycle.ready, dispose: () => {
        expect(probeEnd).toHaveBeenCalledTimes(1)
        expect(pool.ended).toBe(true)
        lifecycle.dispose()
        probeDispose()
      } }
    })
    if (queryFails) probeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('scheduled_jobs')) throw new Error('schedule query failed')
      return { rows: [] }
    })
    try {
      const result = await probeEnabledSchedules({ DATABASE_URL: 'runtime' })
      expect(result).toEqual(queryFails
        ? { enabledSchedules: 0, dueSchedules: 0, error: true, errorMessage: 'schedule query failed' }
        : { enabledSchedules: 3, dueSchedules: 1, error: false })
      expect(probeDispose).toHaveBeenCalledTimes(1)
    } finally {
      probeFreshContext.mockImplementation((_context, callback) => callback())
    }
  })

  it('keeps the direct runtime URL and existing missing-table behavior when disabled', async () => {
    probeEnabled.mockReturnValue(false)
    probeQuery.mockRejectedValue(Object.assign(new Error('missing'), { code: '42P01' }))
    await expect(probeEnabledSchedules({ DATABASE_URL: 'runtime' })).resolves.toEqual({ enabledSchedules: 0, dueSchedules: 0, error: false })
    expect(require('pg').Client).toHaveBeenCalledWith(expect.objectContaining({ connectionString: 'runtime' }))
    expect(configureProbePool).not.toHaveBeenCalled()
    expect(probeFreshContext).not.toHaveBeenCalled()
  })
})
