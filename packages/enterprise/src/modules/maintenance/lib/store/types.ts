import type { MaintenanceProcessRecord, MaintenanceStateV1 } from '../state'

export type StoredStateRead =
  | { kind: 'missing' }
  | { kind: 'ok'; state: MaintenanceStateV1 }
  | { kind: 'unsupported'; reason: string }

export interface MaintenanceStateStore {
  readonly kind: 'file' | 'redis'
  readonly multiHost: boolean
  readState(): Promise<StoredStateRead>
  /** Writes `next` only when the stored revision still equals `expectedRevision` (0 = no document yet). */
  compareAndSet(expectedRevision: number, next: MaintenanceStateV1): Promise<boolean>
  writeProcess(record: MaintenanceProcessRecord, ttlMs: number): Promise<void>
  removeProcess(processId: string): Promise<void>
  listProcesses(): Promise<MaintenanceProcessRecord[]>
  /** Authoritative clock (Redis TIME or the file host's clock). */
  now(): Promise<Date>
  isDurable(): Promise<boolean>
  close(): Promise<void>
}
