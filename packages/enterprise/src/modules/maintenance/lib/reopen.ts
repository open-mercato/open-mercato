import type { DrainReport, MaintenanceExpectedProcesses } from '@open-mercato/shared/lib/maintenance/types'
import { evaluateDrain } from './drain'
import type { MaintenanceProcessRecord, MaintenanceStateV1 } from './state'

export type ReopenCheck =
  | { ok: true }
  | { ok: false; reason: 'pending_verification' }
  | { ok: false; reason: 'writers_not_restarted'; processes: MaintenanceProcessRecord[]; report: DrainReport }

/**
 * A reopen barrier clears only after verified success recorded a generation and every live
 * writer is a replacement started after that generation (it loaded the new policy and keys),
 * with the expected inventory present.
 */
export function checkReopenBarrier(input: {
  state: MaintenanceStateV1
  processes: MaintenanceProcessRecord[]
  expected: MaintenanceExpectedProcesses | null
  now: Date
  heartbeatMs: number
}): ReopenCheck {
  const barrier = input.state.reopenBarrier
  if (!barrier) return { ok: true }
  if (!barrier.generation) return { ok: false, reason: 'pending_verification' }
  const generationAt = Date.parse(barrier.generation)
  const report = evaluateDrain({
    processes: input.processes,
    targetRevision: input.state.gateRevision,
    expected: input.expected,
    now: input.now,
    heartbeatMs: input.heartbeatMs,
  })
  const liveIds = new Set(report.processes.filter((entry) => !entry.stale).map((entry) => entry.processId))
  const notRestarted = input.processes.filter((record) => liveIds.has(record.processId) && !(Date.parse(record.loadedGeneration ?? record.startedAt) >= generationAt))
  if (notRestarted.length > 0 || report.missing.length > 0) {
    return { ok: false, reason: 'writers_not_restarted', processes: notRestarted, report }
  }
  return { ok: true }
}
