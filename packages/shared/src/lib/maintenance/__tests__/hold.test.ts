import { resolveMaintenanceCoordinator, withMaintenanceHold } from '../hold'
import {
  MAINTENANCE_COORDINATOR_DI_KEY,
  MaintenanceDrainTimeoutError,
  MaintenanceNotActiveError,
  type MaintenanceCoordinator,
  type MaintenanceHold,
} from '../types'

function containerWith(coordinator: MaintenanceCoordinator | null) {
  return {
    hasRegistration: (name: string) => name === MAINTENANCE_COORDINATOR_DI_KEY && coordinator !== null,
    resolve: <T,>(name: string): T => {
      if (name !== MAINTENANCE_COORDINATOR_DI_KEY || !coordinator) throw new Error('not registered')
      return coordinator as unknown as T
    },
  }
}

function buildCoordinator(overrides: Partial<MaintenanceCoordinator> = {}) {
  const hold: MaintenanceHold = {
    id: 'hold-1',
    windowId: 'window-1',
    drainReport: { drained: true, gateRevision: 2, processes: [], outstanding: [], missing: [], checkedAt: new Date().toISOString() },
    assertLive: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  }
  const coordinator: MaintenanceCoordinator = {
    getState: jest.fn(async () => ({
      active: true, source: 'store' as const, windowId: 'window-1', epoch: 1, gateRevision: 1,
      startedAt: null, until: null, retryAfterSeconds: 300, hold: null, reopenBarrier: null,
    })),
    enter: jest.fn(async () => ({ windowId: 'window-1', enteredByCaller: true })),
    acquireHold: jest.fn(async () => hold),
    exit: jest.fn(async () => {}),
    ...overrides,
  }
  return { coordinator, hold }
}

describe('withMaintenanceHold', () => {
  it('runs the callback unchanged when no coordinator is registered (OSS path)', async () => {
    const result = await withMaintenanceHold(containerWith(null), 'encryption.rotate', {}, async (scope) => {
      expect(scope.hold).toBeNull()
      await scope.assertLive()
      return 'done'
    })
    expect(result).toBe('done')
  })

  it('treats a throwing resolve as no coordinator', () => {
    expect(resolveMaintenanceCoordinator({ resolve: () => { throw new Error('missing') } })).toBeNull()
  })

  it('acquires a bypass-forbidding drained hold and releases it after success', async () => {
    const { coordinator, hold } = buildCoordinator()
    await withMaintenanceHold(containerWith(coordinator), 'encryption.rotate', { drainTimeoutMs: 5000 }, async (scope) => {
      await scope.assertLive()
      expect(scope.windowId).toBe('window-1')
    })
    expect(coordinator.acquireHold).toHaveBeenCalledWith({
      operation: 'encryption.rotate', forbidsBypass: true, requireDrained: true, drainTimeoutMs: 5000,
    })
    expect(hold.assertLive).toHaveBeenCalledTimes(1)
    expect(hold.release).toHaveBeenCalledTimes(1)
    expect(coordinator.exit).not.toHaveBeenCalled()
  })

  it('releases the hold and keeps the window when the callback fails', async () => {
    const { coordinator, hold } = buildCoordinator()
    await expect(withMaintenanceHold(containerWith(coordinator), 'op', {}, async () => {
      throw new Error('rotation failed')
    })).rejects.toThrow('rotation failed')
    expect(hold.release).toHaveBeenCalledTimes(1)
    expect(coordinator.exit).not.toHaveBeenCalled()
  })

  it('never runs the callback when the hold cannot be acquired', async () => {
    const { coordinator } = buildCoordinator({ acquireHold: jest.fn(async () => { throw new MaintenanceNotActiveError() }) })
    const callback = jest.fn(async () => {})
    await expect(withMaintenanceHold(containerWith(coordinator), 'op', {}, callback)).rejects.toBeInstanceOf(MaintenanceNotActiveError)
    expect(callback).not.toHaveBeenCalled()
  })

  it('enters the window first with enterIfInactive', async () => {
    const { coordinator } = buildCoordinator({
      getState: jest.fn(async () => ({
        active: false, source: 'store' as const, windowId: null, epoch: 0, gateRevision: 0,
        startedAt: null, until: null, retryAfterSeconds: 300, hold: null, reopenBarrier: null,
      })),
    })
    await withMaintenanceHold(containerWith(coordinator), 'op', { enterIfInactive: true }, async (scope) => {
      expect(scope.enteredByCaller).toBe(true)
    })
    expect(coordinator.enter).toHaveBeenCalledTimes(1)
  })

  it('exposes the drain report on timeout errors', () => {
    const report = { drained: false, gateRevision: 3, processes: [], outstanding: [], missing: [], checkedAt: 'now' }
    const error = new MaintenanceDrainTimeoutError(report)
    expect(error.code).toBe('MAINTENANCE_DRAIN_TIMEOUT')
    expect(error.report).toBe(report)
    expect(error.name).toBe('MaintenanceDrainTimeoutError')
  })
})
