import type { XrayStatusResponse } from '../../data/validators'
import { compareCodeUnits } from '../process/registry'
import type { XrayStatus } from './jobs'

const DAY_MS = 24 * 60 * 60_000

function leaseActive(leaseUntil: string | null, leaseOwner: string | null, nowMs: number): boolean {
  if (!leaseOwner || !leaseUntil) return false
  return Date.parse(leaseUntil) > nowMs
}

function microIso(ms: number): string {
  return new Date(ms).toISOString().replace(/Z$/, '000Z')
}

/**
 * Audit rows from this time on are projected: the cursor's coverage (its creation, or the
 * lower bound of the last backfill / full reconciliation of every process), never earlier
 * than the retention window, whose older rows are pruned.
 */
function effectiveCoverage(coverageFrom: string | null, retentionDays: number, nowMs: number): string | null {
  if (!coverageFrom) return null
  const retentionStart = nowMs - Math.max(1, retentionDays) * DAY_MS
  return Date.parse(coverageFrom) >= retentionStart ? coverageFrom : microIso(retentionStart)
}

/**
 * Response view of the X-Ray status: identifiers, timestamps and counts only. Processes are
 * limited to the registered ones (rows of a process whose module was disabled stay until
 * retention prunes them, but are not shown); when the counts timed out every registered
 * process is listed with null counts and `countsTimedOut`.
 */
export function toXrayStatusResponse(status: XrayStatus, nowMs: number = Date.now()): XrayStatusResponse {
  const cursor = status.cursor
  const computedThrough = cursor?.lastCreatedAt ?? null
  const coverageFrom = cursor ? effectiveCoverage(cursor.coverageFrom, status.settings.retentionDays, nowMs) : null
  const registeredKeys = status.registry.processes.map((process) => process.processKey)
  const registered = status.registry.ready ? new Set(registeredKeys) : null
  const countsTimedOut = status.countsTimedOut === true
  const rebuilding = cursor
    ? Array.from(new Set([...cursor.pendingRebuildKeys, ...(cursor.scanProcessKeys ?? [])])).sort(compareCodeUnits)
    : []
  const contractHashes = cursor?.contractHashes ?? null
  const contractMatches = contractHashes !== null
    && registeredKeys.every((processKey) => Object.prototype.hasOwnProperty.call(contractHashes, processKey))
    && rebuilding.length === 0
  return {
    organizationId: status.scope.organizationId,
    ingestEnabled: status.ingestEnabled,
    settings: {
      enabled: status.settings.enabled,
      retentionDays: status.settings.retentionDays,
      kAnonymity: status.settings.kAnonymity,
      debounceSeconds: status.settings.debounceSeconds,
      individualsEnabled: status.settings.individualsEnabled,
      timeZone: status.settings.timeZone,
      conformanceWorkflowId: status.settings.conformanceWorkflowId,
      activityStepMap: status.settings.activityStepMap,
      updatedAt: status.settings.updatedAt,
    },
    registry: status.registry,
    cursor: cursor
      ? {
        status: cursor.status,
        contractMatches,
        rebuildingProcessKeys: rebuilding,
        contractChange: cursor.contractChange
          ? { at: cursor.contractChangedAt, ...cursor.contractChange }
          : null,
        computedThrough,
        coverageFrom,
        historyScanned: cursor.historyScannedAt !== null,
        historyScannedAt: cursor.historyScannedAt,
        stateWatermark: cursor.stateWatermark,
        scan: cursor.scanId && cursor.scanKind
          ? {
            id: cursor.scanId,
            kind: cursor.scanKind,
            processKeys: cursor.scanProcessKeys,
            from: cursor.scanFrom,
            until: cursor.scanUntil,
            position: cursor.scanAfterCreatedAt,
            processed: cursor.scanProcessedCount,
            progressJobId: cursor.scanProgressJobId,
            startedAt: cursor.scanStartedAt,
            updatedAt: cursor.scanUpdatedAt,
          }
          : null,
        lastReconciledAt: cursor.lastReconciledAt,
        lastFullReconciledAt: cursor.lastFullReconciledAt,
        lastPrunedAt: cursor.lastPrunedAt,
        lastRunAt: cursor.lastRunAt,
        lastError: cursor.lastError,
        undecryptableRows: cursor.undecryptableRows,
        overlapTimeouts: cursor.overlapTimeouts,
        lastOverlapTimeoutAt: cursor.lastOverlapTimeoutAt,
        leaseActive: leaseActive(cursor.leaseUntil, cursor.leaseOwner, nowMs),
      }
      : null,
    processes: countsTimedOut
      ? registeredKeys.map((processKey) => ({
        processKey,
        n: null,
        voidedEvents: null,
        cases: null,
        openCases: null,
        firstOccurredAt: null,
        lastOccurredAt: null,
      }))
      : status.counts
        .filter((count) => !registered || registered.has(count.processKey))
        .map((count) => ({
          processKey: count.processKey,
          n: count.events,
          voidedEvents: count.voidedEvents,
          cases: count.cases,
          openCases: count.openCases,
          firstOccurredAt: count.firstOccurredAt,
          lastOccurredAt: count.lastOccurredAt,
        })),
    countsTimedOut,
    computedThrough,
    coverageFrom,
  }
}
