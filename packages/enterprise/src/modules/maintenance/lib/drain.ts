import type {
  DrainReport,
  MaintenanceDrainProcessReport,
  MaintenanceExpectedProcesses,
  MaintenanceProcessKind,
} from '@open-mercato/shared/lib/maintenance/types'
import type { MaintenanceProcessRecord } from './state'

export const STALE_HEARTBEAT_MULTIPLIER = 3

export function isHeartbeatStale(heartbeatAt: string, now: Date, heartbeatMs: number): boolean {
  const at = Date.parse(heartbeatAt)
  if (!Number.isFinite(at)) return true
  return now.getTime() - at > heartbeatMs * STALE_HEARTBEAT_MULTIPLIER
}

/**
 * Evaluates drain evidence. Every live process must acknowledge `targetRevision` with zero
 * in-flight work, and every role in the expected inventory must be present in full.
 * Extra (discovered) processes must also acknowledge; stale records are not evidence.
 */
export function evaluateDrain(input: {
  processes: MaintenanceProcessRecord[]
  targetRevision: number
  expected: MaintenanceExpectedProcesses | null
  now: Date
  heartbeatMs: number
}): DrainReport {
  const reports: MaintenanceDrainProcessReport[] = input.processes.map((record) => {
    const stale = isHeartbeatStale(record.heartbeatAt, input.now, input.heartbeatMs)
    return {
      processId: record.processId,
      kind: record.kind,
      host: record.host,
      pid: record.pid,
      ackedGateRevision: record.ackedGateRevision,
      inflight: record.inflight,
      heartbeatAt: record.heartbeatAt,
      stale,
      acknowledged: !stale && record.ackedGateRevision >= input.targetRevision && record.inflight === 0,
    }
  })
  const live = reports.filter((report) => !report.stale)
  const outstanding = live.filter((report) => !report.acknowledged)
  const missing: DrainReport['missing'] = []
  if (input.expected) {
    for (const kind of ['web', 'worker', 'scheduler'] as MaintenanceProcessKind[]) {
      const expected = input.expected[kind] ?? 0
      const seen = live.filter((report) => report.kind === kind).length
      if (seen < expected) missing.push({ kind, expected, seen })
    }
  }
  return {
    drained: outstanding.length === 0 && missing.length === 0,
    gateRevision: input.targetRevision,
    processes: reports,
    outstanding,
    missing,
    checkedAt: input.now.toISOString(),
  }
}
