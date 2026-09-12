import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleRuntime } from '@open-mercato/shared/modules/runtime'
import {
  isProductionBuildPhase,
  startModuleRuntimes,
  type ModuleRuntimeCarrier,
} from '../lib/module-runtimes'

const container = {} as AppContainer
const silent = () => {}

function moduleWith(id: string, runtime: ModuleRuntime): ModuleRuntimeCarrier {
  return { id, runtime }
}

describe('startModuleRuntimes', () => {
  it('starts only the modules that declare a runtime', async () => {
    const start = jest.fn().mockResolvedValue(undefined)
    const started = await startModuleRuntimes({
      modules: [{ id: 'no_runtime' }, moduleWith('has_runtime', { start })],
      container,
      role: 'server',
      log: silent,
    })

    expect(start).toHaveBeenCalledTimes(1)
    expect(started.started).toEqual(['has_runtime'])
  })

  it('starts in module id order, so a failure is reproducible', async () => {
    const order: string[] = []
    const record = (id: string): ModuleRuntime => ({ start: async () => { order.push(id) } })

    await startModuleRuntimes({
      modules: [moduleWith('zulu', record('zulu')), moduleWith('alpha', record('alpha')), moduleWith('mike', record('mike'))],
      container,
      role: 'server',
      log: silent,
    })

    expect(order).toEqual(['alpha', 'mike', 'zulu'])
  })

  it('honours the roles a runtime declares, defaulting to server and worker', async () => {
    const everywhere = jest.fn().mockResolvedValue(undefined)
    const workerOnly = jest.fn().mockResolvedValue(undefined)
    const modules = [
      moduleWith('default_roles', { start: everywhere }),
      moduleWith('worker_only', { roles: ['worker'], start: workerOnly }),
    ]

    await startModuleRuntimes({ modules, container, role: 'server', log: silent })
    expect(everywhere).toHaveBeenCalledTimes(1)
    expect(workerOnly).not.toHaveBeenCalled()

    await startModuleRuntimes({ modules, container, role: 'scheduler', log: silent })
    // Still once: 'scheduler' is not in the default set, so neither module applies.
    expect(everywhere).toHaveBeenCalledTimes(1)
    expect(workerOnly).toHaveBeenCalledTimes(0)

    await startModuleRuntimes({ modules, container, role: 'worker', log: silent })
    expect(everywhere).toHaveBeenCalledTimes(2)
    expect(workerOnly).toHaveBeenCalledTimes(1)
  })

  it('fails startup when a runtime throws, and stops the ones already started', async () => {
    const stop = jest.fn().mockResolvedValue(undefined)
    const modules = [
      moduleWith('a_ok', { start: async () => ({ stop }) }),
      moduleWith('b_broken', { start: async () => { throw new Error('no broker') } }),
    ]

    await expect(startModuleRuntimes({ modules, container, role: 'server', log: silent }))
      .rejects.toThrow('no broker')

    // The whole point: a half-started process must not be left running. A module that came up
    // before the failure holds a lease or a subscription, and nothing else will release it.
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('fails startup when a runtime does not start within the timeout', async () => {
    const modules = [moduleWith('slow', { start: () => new Promise<never>(() => {}) })]

    await expect(startModuleRuntimes({ modules, container, role: 'server', log: silent, startTimeoutMs: 10 }))
      .rejects.toThrow(/did not start within 10ms/)
  })

  it('stops runtimes in reverse start order', async () => {
    const order: string[] = []
    const runtime = (id: string): ModuleRuntime => ({
      start: async () => ({ stop: async () => { order.push(id) } }),
    })

    const started = await startModuleRuntimes({
      modules: [moduleWith('alpha', runtime('alpha')), moduleWith('bravo', runtime('bravo'))],
      container,
      role: 'server',
      log: silent,
    })
    await started.stop()

    expect(order).toEqual(['bravo', 'alpha'])
  })

  it('aborts the shared signal before stopping, so a runtime can wind down at its own boundary', async () => {
    let abortedDuringStop: boolean | null = null
    const started = await startModuleRuntimes({
      modules: [moduleWith('watcher', {
        start: async ({ signal }) => ({ stop: async () => { abortedDuringStop = signal.aborted } }),
      })],
      container,
      role: 'server',
      log: silent,
    })

    await started.stop()
    expect(abortedDuringStop).toBe(true)
  })

  it('keeps going when one runtime fails to stop, and does not hang on one that never does', async () => {
    const lastStopped = jest.fn().mockResolvedValue(undefined)
    const started = await startModuleRuntimes({
      modules: [
        moduleWith('a_first', { start: async () => ({ stop: lastStopped }) }),
        moduleWith('b_throws', { start: async () => ({ stop: async () => { throw new Error('rude') } }) }),
        moduleWith('c_hangs', { start: async () => ({ stop: () => new Promise<never>(() => {}) }) }),
      ],
      container,
      role: 'server',
      log: silent,
      stopTimeoutMs: 10,
    })

    // Resolves rather than rejecting or hanging: shutdown is best-effort by design, because a
    // shutdown that cannot finish would otherwise become one that never finishes.
    await expect(started.stop()).resolves.toBeUndefined()
    expect(lastStopped).toHaveBeenCalledTimes(1)
  })

  it('stops only once however many times stop is called', async () => {
    const stop = jest.fn().mockResolvedValue(undefined)
    const started = await startModuleRuntimes({
      modules: [moduleWith('once', { start: async () => ({ stop }) })],
      container,
      role: 'server',
      log: silent,
    })

    await Promise.all([started.stop(), started.stop(), started.stop()])
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('tolerates a runtime that returns no handle', async () => {
    const started = await startModuleRuntimes({
      modules: [moduleWith('fire_and_forget', { start: async () => undefined })],
      container,
      role: 'server',
      log: silent,
    })

    await expect(started.stop()).resolves.toBeUndefined()
  })
})

describe('isProductionBuildPhase', () => {
  it('detects a Next production build', () => {
    expect(isProductionBuildPhase({ NEXT_PHASE: 'phase-production-build' } as NodeJS.ProcessEnv)).toBe(true)
  })

  it('is false for a server, a worker and an unset environment', () => {
    expect(isProductionBuildPhase({ NEXT_PHASE: 'phase-production-server' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isProductionBuildPhase({} as NodeJS.ProcessEnv)).toBe(false)
  })
})
