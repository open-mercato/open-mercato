import os from 'node:os'
import {
  MaintenanceDrainTimeoutError,
  MaintenanceHeldError,
  MaintenanceHoldLostError,
  MaintenanceInventoryMissingError,
  MaintenanceNotActiveError,
  MaintenanceOperationBusyError,
  MaintenanceStoreNotDurableError,
  MaintenanceWriterFenceUnavailableError,
} from '@open-mercato/shared/lib/maintenance/types'
import { createMaintenanceCoordinator } from '../lib/coordinator'
import { createFileMaintenanceStore } from '../lib/store/file'
import { mutateState } from '../lib/transitions'
import type { MaintenanceProcessRecord } from '../lib/state'
import type { MaintenanceStateStore } from '../lib/store/types'
import { makeConfig, makeTempDir } from './helpers'

function processRecord(overrides: Partial<MaintenanceProcessRecord>): MaintenanceProcessRecord {
  return {
    processId: 'p1', kind: 'web', host: os.hostname(), pid: 1, startedAt: new Date().toISOString(),
    ackedGateRevision: 0, loadedGeneration: null, inflight: 0, heartbeatAt: new Date().toISOString(), ...overrides,
  }
}

function setup(configOverrides: Parameters<typeof makeConfig>[1] = {}, storeOverrides: Partial<MaintenanceStateStore> = {}) {
  const dir = makeTempDir()
  const store = { ...createFileMaintenanceStore(dir), ...storeOverrides } as MaintenanceStateStore
  const config = makeConfig(dir, { heartbeatMs: 1000, expectedProcesses: { web: 1, worker: 0, scheduler: 0 }, ...configOverrides })
  const coordinator = createMaintenanceCoordinator({ config, getStore: async () => store })
  return { store, coordinator, config }
}

const holdInput = { operation: 'encryption.rotate', forbidsBypass: true, requireDrained: true, drainTimeoutMs: 300 }

async function ackLatest(store: MaintenanceStateStore, overrides: Partial<MaintenanceProcessRecord> = {}) {
  const read = await store.readState()
  const revision = read.kind === 'ok' ? read.state.gateRevision : 0
  await store.writeProcess(processRecord({ ackedGateRevision: revision, heartbeatAt: new Date().toISOString(), ...overrides }), 1000)
}

describe('maintenance coordinator holds', () => {
  it('refuses a hold without an active window', async () => {
    const { coordinator } = setup()
    await expect(coordinator.acquireHold(holdInput)).rejects.toBeInstanceOf(MaintenanceNotActiveError)
  })

  it('requires an expected-process inventory for drained holds', async () => {
    const { coordinator } = setup({ expectedProcesses: null })
    await coordinator.enter({ operation: 'test' })
    await expect(coordinator.acquireHold(holdInput)).rejects.toBeInstanceOf(MaintenanceInventoryMissingError)
  })

  it('refuses a non-durable store', async () => {
    const { coordinator } = setup({}, { isDurable: async () => false })
    await coordinator.enter({ operation: 'test' })
    await expect(coordinator.acquireHold(holdInput)).rejects.toBeInstanceOf(MaintenanceStoreNotDurableError)
  })

  it('refuses a single-host file store when writers on other hosts heartbeat', async () => {
    const { coordinator, store } = setup()
    await coordinator.enter({ operation: 'test' })
    await store.writeProcess(processRecord({ host: 'other-host' }), 1000)
    await expect(coordinator.acquireHold(holdInput)).rejects.toBeInstanceOf(MaintenanceWriterFenceUnavailableError)
  })

  it('times out when a writer never acknowledges the new revision, releasing only its own reservation', async () => {
    const { coordinator, store } = setup()
    const { windowId } = await coordinator.enter({ operation: 'test' })
    await ackLatest(store)
    let caught: unknown
    try {
      await coordinator.acquireHold(holdInput)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(MaintenanceDrainTimeoutError)
    expect((caught as MaintenanceDrainTimeoutError).report.outstanding.map((entry) => entry.processId)).toEqual(['p1'])
    const state = await coordinator.getState()
    expect(state.active).toBe(true)
    expect(state.windowId).toBe(windowId)
    expect(state.hold).toBeNull()
  })

  it('times out when an expected role is missing and names it', async () => {
    const { coordinator } = setup({ expectedProcesses: { web: 1, worker: 2, scheduler: 0 } })
    await coordinator.enter({ operation: 'test' })
    const error = await coordinator.acquireHold(holdInput).catch((caught) => caught)
    expect(error).toBeInstanceOf(MaintenanceDrainTimeoutError)
    expect((error as MaintenanceDrainTimeoutError).report.missing).toEqual(expect.arrayContaining([{ kind: 'worker', expected: 2, seen: 0 }]))
  })

  it('does not accept old acknowledgments or in-flight bypass work for a new restrictive hold', async () => {
    const { coordinator, store } = setup()
    await coordinator.enter({ operation: 'test' })
    await ackLatest(store)
    const acquiring = coordinator.acquireHold({ ...holdInput, drainTimeoutMs: 2000 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await ackLatest(store, { inflight: 1 })
    await new Promise((resolve) => setTimeout(resolve, 600))
    let settled = false
    void acquiring.then(() => { settled = true }, () => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(settled).toBe(false)
    await ackLatest(store, { inflight: 0 })
    const hold = await acquiring
    expect(hold.drainReport.drained).toBe(true)
    await hold.release()
  })

  it('grants exactly one exclusive hold; a competing acquisition is busy', async () => {
    const { coordinator, store } = setup({ expectedProcesses: { web: 0, worker: 0, scheduler: 0 } })
    await coordinator.enter({ operation: 'test' })
    const hold = await coordinator.acquireHold(holdInput)
    await expect(coordinator.acquireHold({ ...holdInput, operation: 'backups.restore' })).rejects.toBeInstanceOf(MaintenanceOperationBusyError)
    await hold.assertLive()
    await hold.release()
    const state = await coordinator.getState()
    expect(state.active).toBe(true)
    expect(state.hold).toBeNull()
    void store
  })

  it('assertLive fails once the hold is no longer in the authoritative store', async () => {
    const { coordinator, store } = setup({ expectedProcesses: { web: 0, worker: 0, scheduler: 0 } })
    await coordinator.enter({ operation: 'test' })
    const hold = await coordinator.acquireHold(holdInput)
    await mutateState(store, (current) => ({ next: { ...current, hold: null }, result: undefined }))
    await expect(hold.assertLive()).rejects.toBeInstanceOf(MaintenanceHoldLostError)
    await hold.release()
  })

  it('assertLive fails when the store becomes unreachable', async () => {
    const { coordinator, store } = setup({ expectedProcesses: { web: 0, worker: 0, scheduler: 0 } })
    await coordinator.enter({ operation: 'test' })
    const hold = await coordinator.acquireHold(holdInput)
    const original = store.readState
    store.readState = async () => { throw new Error('down') }
    await expect(hold.assertLive()).rejects.toBeInstanceOf(MaintenanceHoldLostError)
    store.readState = original
    await hold.release()
  })

  it('exit refuses while a hold or reopen barrier exists, then ends the window', async () => {
    const { coordinator } = setup({ expectedProcesses: { web: 0, worker: 0, scheduler: 0 } })
    const { windowId } = await coordinator.enter({ operation: 'test' })
    const hold = await coordinator.acquireHold(holdInput)
    await expect(coordinator.exit({ windowId, operation: 'test' })).rejects.toBeInstanceOf(MaintenanceHeldError)
    await hold.setReopenBarrier?.(null)
    await hold.release()
    await expect(coordinator.exit({ windowId, operation: 'test' })).rejects.toBeInstanceOf(MaintenanceHeldError)
    expect((await coordinator.getState()).reopenBarrier).toEqual({ operationId: hold.id, generation: null })
  })

  it('enter joins an already-active window without a new epoch', async () => {
    const { coordinator } = setup()
    const first = await coordinator.enter({ operation: 'a' })
    const second = await coordinator.enter({ operation: 'b' })
    expect(first.enteredByCaller).toBe(true)
    expect(second).toEqual({ windowId: first.windowId, enteredByCaller: false })
  })
})
