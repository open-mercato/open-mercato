import { ENCRYPTION_MAINTENANCE_EXIT, runEncryptionMaintenance, type EncryptionMaintenanceIo } from '../cli'
import {
  MAINTENANCE_COORDINATOR_DI_KEY,
  MaintenanceDrainTimeoutError,
  MaintenanceHeldError,
  MaintenanceHoldLostError,
  MaintenanceNotActiveError,
  MaintenanceOperationBusyError,
  MaintenanceStoreNotDurableError,
  MaintenanceStoreUnavailableError,
  type MaintenanceCoordinator,
  type MaintenanceHold,
} from '../types'

function harness(coordinatorOverrides: Partial<MaintenanceCoordinator> | null) {
  const hold: MaintenanceHold = {
    id: 'hold-1',
    windowId: 'window-1',
    drainReport: { drained: true, gateRevision: 2, processes: [], outstanding: [], missing: [], checkedAt: 'now' },
    assertLive: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  }
  const coordinator: MaintenanceCoordinator | null = coordinatorOverrides === null ? null : {
    getState: jest.fn(async () => ({
      active: true, source: 'store' as const, windowId: 'window-1', epoch: 1, gateRevision: 1,
      startedAt: null, until: null, retryAfterSeconds: 300, hold: null, reopenBarrier: null,
    })),
    enter: jest.fn(async () => ({ windowId: 'window-1', enteredByCaller: true })),
    acquireHold: jest.fn(async () => hold),
    exit: jest.fn(async () => {}),
    ...coordinatorOverrides,
  }
  const container = {
    resolve: <T,>(name: string): T => {
      if (name === MAINTENANCE_COORDINATOR_DI_KEY && coordinator) return coordinator as unknown as T
      throw new Error('not registered')
    },
  }
  const output: string[] = []
  let exitCode: number | null = null
  const io: EncryptionMaintenanceIo = {
    log: (message) => output.push(message),
    error: (message) => output.push(message),
    setExitCode: (code) => { exitCode = code },
  }
  const writes = jest.fn(async () => {})
  return { container, coordinator, hold, io, output, writes, exitCode: () => exitCode }
}

const options = { operation: 'encryption.entities.rotate-encryption-key', dryRun: false, enterMaintenance: false, exitMaintenance: false }

describe('runEncryptionMaintenance', () => {
  it('runs unchanged without a coordinator (OSS path)', async () => {
    const h = harness(null)
    await runEncryptionMaintenance(h.container, options, async () => h.writes(), h.io)
    expect(h.writes).toHaveBeenCalledTimes(1)
    expect(h.exitCode()).toBeNull()
    expect(h.output).toEqual([])
  })

  it('exempts dry runs from the maintenance requirement', async () => {
    const h = harness({ acquireHold: jest.fn(async () => { throw new MaintenanceNotActiveError() }) })
    await runEncryptionMaintenance(h.container, { ...options, dryRun: true }, async () => h.writes(), h.io)
    expect(h.writes).toHaveBeenCalledTimes(1)
    expect(h.coordinator!.acquireHold).not.toHaveBeenCalled()
  })

  it.each([
    [new MaintenanceNotActiveError(), ENCRYPTION_MAINTENANCE_EXIT.notActive, 'mercato maintenance on --wait-drain'],
    [new MaintenanceDrainTimeoutError({ drained: false, gateRevision: 3, processes: [], outstanding: [{ processId: 'p', kind: 'worker', host: 'h', pid: 9, ackedGateRevision: 2, inflight: 1, heartbeatAt: 'x', stale: false, acknowledged: false }], missing: [{ kind: 'web', expected: 2, seen: 1 }], checkedAt: 'x' }), ENCRYPTION_MAINTENANCE_EXIT.drainTimeout, 'missing web'],
    [new MaintenanceStoreUnavailableError(), ENCRYPTION_MAINTENANCE_EXIT.storeUnavailable, 'unreachable'],
    [new MaintenanceStoreNotDurableError(), ENCRYPTION_MAINTENANCE_EXIT.storeUnavailable, 'not durable'],
    [new MaintenanceOperationBusyError({ operation: 'backups.restore', holdId: 'x' }), ENCRYPTION_MAINTENANCE_EXIT.busy, 'backups.restore'],
  ])('refuses with zero writes when the hold cannot be acquired (%s)', async (error, exitCode, hint) => {
    const h = harness({ acquireHold: jest.fn(async () => { throw error }) })
    await runEncryptionMaintenance(h.container, options, async () => h.writes(), h.io)
    expect(h.writes).not.toHaveBeenCalled()
    expect(h.exitCode()).toBe(exitCode)
    expect(h.output.join('\n')).toContain('ERROR')
    expect(h.output.join('\n')).toContain(hint)
  })

  it('acquires an exclusive bypass-forbidding drained hold, releases it, and leaves the mode on', async () => {
    const h = harness({})
    await runEncryptionMaintenance(h.container, options, async (scope) => {
      await scope.assertLive()
      await h.writes()
    }, h.io)
    expect(h.coordinator!.acquireHold).toHaveBeenCalledWith(expect.objectContaining({ forbidsBypass: true, requireDrained: true }))
    expect(h.hold.release).toHaveBeenCalledTimes(1)
    expect(h.coordinator!.exit).not.toHaveBeenCalled()
    expect(h.output.join('\n')).toContain('stays ON')
  })

  it('releases the hold and keeps the mode on when the command fails', async () => {
    const h = harness({})
    await expect(runEncryptionMaintenance(h.container, options, async () => { throw new Error('rotation failed') }, h.io)).rejects.toThrow('rotation failed')
    expect(h.hold.release).toHaveBeenCalledTimes(1)
    expect(h.coordinator!.exit).not.toHaveBeenCalled()
  })

  it('stops cleanly when the hold is lost before the next batch', async () => {
    const h = harness({})
    await runEncryptionMaintenance(h.container, options, async () => { throw new MaintenanceHoldLostError() }, h.io)
    expect(h.exitCode()).toBe(ENCRYPTION_MAINTENANCE_EXIT.storeUnavailable)
    expect(h.hold.release).toHaveBeenCalledTimes(1)
  })

  it('enters the window with --enter-maintenance and exits only after success with --exit-maintenance', async () => {
    const h = harness({
      getState: jest.fn(async () => ({
        active: false, source: 'store' as const, windowId: null, epoch: 0, gateRevision: 0,
        startedAt: null, until: null, retryAfterSeconds: 300, hold: null, reopenBarrier: null,
      })),
    })
    await runEncryptionMaintenance(h.container, { ...options, enterMaintenance: true, exitMaintenance: true }, async () => h.writes(), h.io)
    expect(h.coordinator!.enter).toHaveBeenCalledTimes(1)
    expect(h.coordinator!.exit).toHaveBeenCalledWith({ windowId: 'window-1', operation: options.operation })
  })

  it('keeps the mode on when a reopen barrier blocks --exit-maintenance', async () => {
    const h = harness({ exit: jest.fn(async () => { throw new MaintenanceHeldError() }) })
    await runEncryptionMaintenance(h.container, { ...options, exitMaintenance: true }, async () => h.writes(), h.io)
    expect(h.exitCode()).toBe(ENCRYPTION_MAINTENANCE_EXIT.busy)
    expect(h.output.join('\n')).toContain('maintenance stays ON')
  })
})
