import type { XrayStatusResponse } from '../../data/validators'
import type { XrayStatus } from './jobs'

function leaseActive(leaseUntil: string | null, leaseOwner: string | null, nowMs: number): boolean {
  if (!leaseOwner || !leaseUntil) return false
  return Date.parse(leaseUntil) > nowMs
}

/** Response view of the X-Ray status: identifiers, timestamps and counts only. */
export function toXrayStatusResponse(status: XrayStatus, nowMs: number = Date.now()): XrayStatusResponse {
  const cursor = status.cursor
  const computedThrough = cursor?.lastCreatedAt ?? null
  return {
    organizationId: status.scope.organizationId,
    ingestEnabled: status.ingestEnabled,
    settings: {
      enabled: status.settings.enabled,
      retentionDays: status.settings.retentionDays,
      kAnonymity: status.settings.kAnonymity,
      debounceSeconds: status.settings.debounceSeconds,
      individualsEnabled: status.settings.individualsEnabled,
      conformanceWorkflowId: status.settings.conformanceWorkflowId,
      activityStepMap: status.settings.activityStepMap,
      updatedAt: status.settings.updatedAt,
    },
    registry: status.registry,
    cursor: cursor
      ? {
        status: cursor.status,
        contractMatches: cursor.contractHash === status.registry.contractHash,
        computedThrough,
        stateWatermark: cursor.stateWatermark,
        scan: cursor.scanId && cursor.scanKind
          ? {
            id: cursor.scanId,
            kind: cursor.scanKind,
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
        leaseActive: leaseActive(cursor.leaseUntil, cursor.leaseOwner, nowMs),
      }
      : null,
    processes: status.counts.map((count) => ({
      processKey: count.processKey,
      n: count.events,
      voidedEvents: count.voidedEvents,
      cases: count.cases,
      openCases: count.openCases,
      lastOccurredAt: count.lastOccurredAt,
    })),
    computedThrough,
  }
}
