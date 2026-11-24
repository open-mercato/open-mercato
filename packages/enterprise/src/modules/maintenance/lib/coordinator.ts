import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  MaintenanceDrainTimeoutError,
  MaintenanceHeldError,
  MaintenanceHoldLostError,
  MaintenanceInventoryMissingError,
  MaintenanceNotActiveError,
  MaintenanceOperationBusyError,
  MaintenanceStoreNotDurableError,
  MaintenanceStoreUnavailableError,
  MaintenanceWriterFenceUnavailableError,
  type DrainReport,
  type MaintenanceCoordinator,
  type MaintenanceEnterInput,
  type MaintenanceExpectedProcesses,
  type MaintenanceHold,
  type MaintenanceHoldInput,
  type MaintenanceStateView,
} from '@open-mercato/shared/lib/maintenance/types'
import type { MaintenanceConfig } from './config'
import { evaluateDrain, isHeartbeatStale, STALE_HEARTBEAT_MULTIPLIER } from './drain'
import { createInitialState, type MaintenanceHoldRecord, type MaintenanceStateV1 } from './state'
import type { MaintenanceStateStore } from './store/types'
import { activateState, deactivateState, deactivationBlock, mutateState } from './transitions'
import { emitMaintenanceEventSafely } from './emit'

const logger = createLogger('maintenance').child({ component: 'coordinator' })

const DRAIN_POLL_MS = 500

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type HoldReservation =
  | { kind: 'not_active' }
  | { kind: 'busy'; holder: { operation: string; holdId: string } }
  | { kind: 'reserved'; windowId: string; gateRevision: number }

export type CoordinatorDeps = {
  config: MaintenanceConfig
  getStore: () => Promise<MaintenanceStateStore>
}

async function storeOrThrow(deps: CoordinatorDeps): Promise<MaintenanceStateStore> {
  try {
    return await deps.getStore()
  } catch {
    throw new MaintenanceStoreUnavailableError()
  }
}

async function readAuthoritative(store: MaintenanceStateStore): Promise<MaintenanceStateV1> {
  let read
  try {
    read = await store.readState()
  } catch {
    throw new MaintenanceStoreUnavailableError()
  }
  if (read.kind === 'unsupported') throw new MaintenanceStoreUnavailableError(`[internal] Maintenance state is unreadable (${read.reason})`)
  return read.kind === 'ok' ? read.state : createInitialState()
}

export function toStateView(state: MaintenanceStateV1, force: boolean): MaintenanceStateView {
  return {
    active: force || state.active,
    source: force ? 'env' : 'store',
    windowId: state.windowId,
    epoch: state.epoch,
    gateRevision: state.gateRevision,
    startedAt: state.startedAt,
    until: state.until,
    retryAfterSeconds: state.retryAfterSeconds,
    hold: state.hold
      ? { id: state.hold.id, operation: state.hold.operation, forbidsBypass: state.hold.forbidsBypass, heartbeatAt: state.hold.heartbeatAt }
      : null,
    reopenBarrier: state.reopenBarrier,
  }
}

export async function collectDrainReport(
  store: MaintenanceStateStore,
  targetRevision: number,
  expected: MaintenanceExpectedProcesses | null,
  heartbeatMs: number,
): Promise<DrainReport> {
  const [processes, now] = await Promise.all([store.listProcesses(), store.now()])
  return evaluateDrain({ processes, targetRevision, expected, now, heartbeatMs })
}

/** Waits until every expected and discovered writer acknowledges `targetRevision` idle, or the timeout expires. */
export async function waitForDrain(
  store: MaintenanceStateStore,
  input: { targetRevision: number; expected: MaintenanceExpectedProcesses | null; heartbeatMs: number; timeoutMs: number; isAborted?: () => Promise<boolean> },
): Promise<DrainReport> {
  const deadline = Date.now() + Math.max(0, input.timeoutMs)
  let report = await collectDrainReport(store, input.targetRevision, input.expected, input.heartbeatMs)
  while (!report.drained && Date.now() < deadline) {
    if (input.isAborted && (await input.isAborted())) break
    await sleep(Math.min(DRAIN_POLL_MS, Math.max(10, deadline - Date.now())))
    report = await collectDrainReport(store, input.targetRevision, input.expected, input.heartbeatMs)
  }
  return report
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM'
  }
}

/** A stale hold may be recovered only when its owner provably stopped: same host and dead pid. */
export function isHoldOwnerProvablyStopped(hold: MaintenanceHoldRecord, now: Date, heartbeatMs: number, host: string): boolean {
  if (!isHeartbeatStale(hold.heartbeatAt, now, heartbeatMs)) return false
  if (hold.host !== host) return false
  return !isProcessAlive(hold.pid)
}

export function createMaintenanceCoordinator(deps: CoordinatorDeps): MaintenanceCoordinator {
  const host = deps.config.host || os.hostname()

  return {
    async getState(): Promise<MaintenanceStateView> {
      const store = await storeOrThrow(deps)
      return toStateView(await readAuthoritative(store), deps.config.force)
    },

    async enter(input: MaintenanceEnterInput) {
      const store = await storeOrThrow(deps)
      const result = await mutateState(store, (current, now) => {
        if (current.active) return { next: null, result: { windowId: current.windowId ?? 'unknown', enteredByCaller: false } }
        const { next, result } = activateState(current, {
          title: input.page?.title,
          message: input.page?.message,
          until: input.until ?? null,
          reason: input.reason,
          startedBy: { source: 'coordinator', host, operation: input.operation, osUser: safeOsUser() },
          expectedProcesses: deps.config.expectedProcesses ?? current.expectedProcesses,
        }, now)
        return { next, result: { windowId: result.windowId, enteredByCaller: true } }
      })
      if (result.enteredByCaller) {
        await emitMaintenanceEventSafely('maintenance.window.started', { windowId: result.windowId, operation: input.operation })
      }
      return result
    },

    async acquireHold(input: MaintenanceHoldInput): Promise<MaintenanceHold> {
      const store = await storeOrThrow(deps)
      const initial = await readAuthoritative(store)
      if (!initial.active || !initial.windowId) throw new MaintenanceNotActiveError()
      const expected = initial.expectedProcesses ?? deps.config.expectedProcesses
      if (input.requireDrained) {
        let durable = false
        try {
          durable = await store.isDurable()
        } catch {
          throw new MaintenanceStoreUnavailableError()
        }
        if (!durable) throw new MaintenanceStoreNotDurableError()
        if (!expected) throw new MaintenanceInventoryMissingError()
        if (!store.multiHost) {
          const hosts = new Set((await store.listProcesses()).map((record) => record.host))
          hosts.delete(host)
          if (hosts.size > 0) throw new MaintenanceWriterFenceUnavailableError()
        }
      }

      const holdId = randomUUID()
      const reservation = await mutateState<HoldReservation>(store, (current, now) => {
        if (!current.active || !current.windowId) return { next: null, result: { kind: 'not_active' as const } }
        if (current.hold) {
          return { next: null, result: { kind: 'busy' as const, holder: { operation: current.hold.operation, holdId: current.hold.id } } }
        }
        const gateRevision = current.gateRevision + 1
        const hold: MaintenanceHoldRecord = {
          id: holdId,
          operation: input.operation,
          pid: process.pid,
          host,
          heartbeatAt: now.toISOString(),
          forbidsBypass: input.forbidsBypass,
          gateRevision,
        }
        return {
          next: { ...current, gateRevision, hold },
          result: { kind: 'reserved' as const, windowId: current.windowId, gateRevision },
        }
      })
      if (reservation.kind === 'not_active') throw new MaintenanceNotActiveError()
      if (reservation.kind === 'busy') throw new MaintenanceOperationBusyError(reservation.holder)

      const windowId = reservation.windowId
      const gateRevision = reservation.gateRevision
      let released = false

      const releaseReservation = async () => {
        if (released) return
        released = true
        clearInterval(heartbeatTimer)
        await mutateState(store, (current) => {
          if (current.hold?.id !== holdId) return { next: null, result: undefined }
          return { next: { ...current, hold: null }, result: undefined }
        }).catch((error) => logger.error('Failed to release maintenance hold', { holdId, err: error }))
        await emitMaintenanceEventSafely('maintenance.hold.released', { windowId, holdId, operation: input.operation })
      }

      const heartbeatTimer = setInterval(() => {
        void mutateState(store, (current, now) => {
          if (current.hold?.id !== holdId) return { next: null, result: undefined }
          return { next: { ...current, hold: { ...current.hold, heartbeatAt: now.toISOString() } }, result: undefined }
        }).catch((error) => logger.warn('Maintenance hold heartbeat failed', { holdId, err: error }))
      }, deps.config.heartbeatMs)
      if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref()

      const assertLive = async () => {
        if (released) throw new MaintenanceHoldLostError()
        let state: MaintenanceStateV1
        try {
          state = await readAuthoritative(store)
        } catch {
          throw new MaintenanceHoldLostError('[internal] Maintenance state store is unreachable; stopping before the next batch')
        }
        const forced = deps.config.force
        if ((!state.active && !forced) || state.windowId !== windowId || state.hold?.id !== holdId || state.gateRevision !== gateRevision) {
          throw new MaintenanceHoldLostError()
        }
      }

      let drainReport: DrainReport
      try {
        if (input.requireDrained) {
          drainReport = await waitForDrain(store, {
            targetRevision: gateRevision,
            expected,
            heartbeatMs: deps.config.heartbeatMs,
            timeoutMs: input.drainTimeoutMs,
            isAborted: async () => {
              try {
                await assertLive()
                return false
              } catch {
                return true
              }
            },
          })
          if (!drainReport.drained) throw new MaintenanceDrainTimeoutError(drainReport)
          await assertLive()
        } else {
          drainReport = await collectDrainReport(store, gateRevision, expected, deps.config.heartbeatMs)
        }
      } catch (error) {
        await releaseReservation()
        throw error
      }

      await emitMaintenanceEventSafely('maintenance.hold.acquired', { windowId, holdId, operation: input.operation })

      return {
        id: holdId,
        windowId,
        drainReport,
        assertLive,
        async setReopenBarrier(generation: string | null) {
          await assertLive()
          await mutateState(store, (current) => {
            if (current.hold?.id !== holdId) throw new MaintenanceHoldLostError()
            return { next: { ...current, reopenBarrier: { operationId: holdId, generation } }, result: undefined }
          })
        },
        release: releaseReservation,
      }
    },

    async exit(input: { windowId: string; operation: string }) {
      const store = await storeOrThrow(deps)
      const outcome = await mutateState(store, (current, now) => {
        if (!current.active) return { next: null, result: 'inactive' as const }
        if (current.windowId !== input.windowId) return { next: null, result: 'other_window' as const }
        if (deactivationBlock(current)) return { next: null, result: 'held' as const }
        return { next: deactivateState(current, now, [input.operation]), result: 'ended' as const }
      })
      if (outcome === 'held') throw new MaintenanceHeldError()
      if (outcome === 'ended') await emitMaintenanceEventSafely('maintenance.window.ended', { windowId: input.windowId, operation: input.operation })
    },
  }
}

function safeOsUser(): string | undefined {
  try {
    return os.userInfo().username
  } catch {
    return undefined
  }
}

export { STALE_HEARTBEAT_MULTIPLIER }
