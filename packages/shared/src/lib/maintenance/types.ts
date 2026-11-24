export const MAINTENANCE_COORDINATOR_DI_KEY = 'maintenanceCoordinator' as const

export const MAINTENANCE_MODE_ERROR_CODE = 'MAINTENANCE_MODE' as const

export type MaintenanceProcessKind = 'web' | 'worker' | 'scheduler'

export type MaintenanceExpectedProcesses = Record<MaintenanceProcessKind, number>

export type MaintenanceDrainProcessReport = {
  processId: string
  kind: MaintenanceProcessKind
  host: string
  pid: number
  ackedGateRevision: number
  inflight: number
  heartbeatAt: string
  stale: boolean
  acknowledged: boolean
}

export type DrainReport = {
  drained: boolean
  gateRevision: number
  processes: MaintenanceDrainProcessReport[]
  outstanding: MaintenanceDrainProcessReport[]
  missing: Array<{ kind: MaintenanceProcessKind; expected: number; seen: number }>
  checkedAt: string
}

export type MaintenanceStateView = {
  active: boolean
  source: 'store' | 'env'
  windowId: string | null
  epoch: number
  gateRevision: number
  startedAt: string | null
  until: string | null
  retryAfterSeconds: number
  hold: { id: string; operation: string; forbidsBypass: boolean; heartbeatAt: string } | null
  reopenBarrier: { operationId: string; generation: string | null } | null
}

export type MaintenanceEnterInput = {
  operation: string
  reason?: string
  page?: { title?: string; message?: string }
  until?: string
}

export type MaintenanceHoldInput = {
  operation: string
  forbidsBypass: boolean
  requireDrained: boolean
  drainTimeoutMs: number
}

export interface MaintenanceHold {
  id: string
  windowId: string
  drainReport: DrainReport
  /** Verifies the window, ownership and gate revision against the authoritative store. Throws when the hold was lost. */
  assertLive(): Promise<void>
  /** Persists a reopen barrier before the first irreversible policy mutation; `generation` stays null until verified. */
  setReopenBarrier?(generation: string | null): Promise<void>
  release(): Promise<void>
}

export interface MaintenanceCoordinator {
  getState(): Promise<MaintenanceStateView>
  enter(input: MaintenanceEnterInput): Promise<{ windowId: string; enteredByCaller: boolean }>
  acquireHold(input: MaintenanceHoldInput): Promise<MaintenanceHold>
  /** Refuses while a hold or reopen barrier exists. */
  exit(input: { windowId: string; operation: string }): Promise<void>
}

export class MaintenanceError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

export class MaintenanceNotActiveError extends MaintenanceError {
  constructor(message = '[internal] No maintenance window is active') {
    super('MAINTENANCE_NOT_ACTIVE', message)
  }
}

export class MaintenanceDrainTimeoutError extends MaintenanceError {
  readonly report: DrainReport
  constructor(report: DrainReport, message = '[internal] Maintenance drain timed out') {
    super('MAINTENANCE_DRAIN_TIMEOUT', message)
    this.report = report
  }
}

export class MaintenanceStoreUnavailableError extends MaintenanceError {
  constructor(message = '[internal] Maintenance state store is unreachable') {
    super('MAINTENANCE_STORE_UNAVAILABLE', message)
  }
}

export class MaintenanceInventoryMissingError extends MaintenanceError {
  constructor(message = '[internal] No expected-process inventory is configured for a drained hold') {
    super('MAINTENANCE_INVENTORY_MISSING', message)
  }
}

export class MaintenanceStoreNotDurableError extends MaintenanceError {
  constructor(message = '[internal] Maintenance state store is not durable') {
    super('MAINTENANCE_STORE_NOT_DURABLE', message)
  }
}

export class MaintenanceOperationBusyError extends MaintenanceError {
  readonly holder: { operation: string; holdId: string } | null
  constructor(holder: { operation: string; holdId: string } | null, message = '[internal] Another maintenance operation holds the window') {
    super('MAINTENANCE_OPERATION_BUSY', message)
    this.holder = holder
  }
}

export class MaintenanceWriterFenceUnavailableError extends MaintenanceError {
  constructor(message = '[internal] The deployment writer fence cannot be verified') {
    super('MAINTENANCE_WRITER_FENCE_UNAVAILABLE', message)
  }
}

export class MaintenanceHoldLostError extends MaintenanceError {
  constructor(message = '[internal] The maintenance hold is no longer live') {
    super('MAINTENANCE_HOLD_LOST', message)
  }
}

export class MaintenanceHeldError extends MaintenanceError {
  constructor(message = '[internal] A hold or reopen barrier blocks leaving maintenance') {
    super('MAINTENANCE_HELD', message)
  }
}

export function isMaintenanceError(error: unknown): error is MaintenanceError {
  return error instanceof MaintenanceError
}
