import { testProcessConfig, testRegistry } from '../../process/__tests__/processTestSupport'
import type { RegisteredProcess } from '../../process/registry'
import { buildCaseTrace, collapseCaseEvents, type AnalyticsEventRow } from '../../analytics/trace'
import { actorOf, caseIdOf, creation, stepRow, DAY_MS, HOUR_MS, MINUTE_MS, ANALYTICS_ORG } from '../../analytics/__tests__/analyticsTestSupport'
import type { MiningCase, MiningThresholds } from '../mine'

export { actorOf, caseIdOf, creation, stepRow, DAY_MS, HOUR_MS, MINUTE_MS, ANALYTICS_ORG }

export const MINING_NOW = Date.UTC(2026, 9, 10, 12, 0, 0)

export const MINING_WINDOW = { fromMs: MINING_NOW - 30 * DAY_MS, toMs: MINING_NOW }

export const TEST_THRESHOLDS: MiningThresholds = {
  minSupport: 5,
  minConfidenceLowerBound: 0.6,
  minLift: 2,
  minDistinctActors: 3,
  minCases: 5,
}

/** The test deal process (stage `status`, `stageId`; follow-ups `ownerUserId` (user), `priority` (enum)) with automation hints. */
export function automatedDealProcess(): RegisteredProcess {
  const config = testProcessConfig()
  const processes = (config.processes ?? []).map((process) => ({ ...process, automation: { updateCommandId: 'test.deals.update' } }))
  return testRegistry({ ...config, processes }).processes[0]
}

export function plainDealProcess(): RegisteredProcess {
  return testRegistry().processes[0]
}

/** Orders rows like the projection (`occurred_at, source_log_id, seq`), builds the trace and applies the collapse. */
export function miningCaseOf(caseId: string, rows: AnalyticsEventRow[], options: { debounceMs?: number; process?: RegisteredProcess } = {}): MiningCase {
  const sorted = [...rows].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
    || left.sourceLogId.localeCompare(right.sourceLogId)
    || left.seq - right.seq)
  const trace = buildCaseTrace({
    organizationId: ANALYTICS_ORG,
    caseId,
    rows: sorted,
    caseRow: null,
    process: options.process ?? plainDealProcess(),
    window: MINING_WINDOW,
    perCaseLimit: 500,
  })
  return { organizationId: ANALYTICS_ORG, caseId, events: collapseCaseEvents(trace.events, options.debounceMs ?? 0).kept }
}

export type DealShape = {
  startMs?: number
  actor?: string
  followup?: { key: string; delayMs: number; actor?: string; cause?: string | null; sync?: boolean } | null
  ownerChanges?: number
  createdCause?: string | null
  createdStatus?: string
}

/**
 * One deal: created (with the initial status) by `actor`, optionally followed by a manual
 * follow-up change, then `ownerChanges` owner hand-overs two hours later (anchors that are never
 * followed by the follow-up, so the lift is measurable).
 */
export function dealRows(index: number, shape: DealShape = {}): AnalyticsEventRow[] {
  const caseId = caseIdOf(index)
  const startMs = shape.startMs ?? MINING_NOW - 20 * DAY_MS + index * HOUR_MS
  const actor = shape.actor ?? actorOf(index % 3)
  const rows = creation(caseId, startMs, { actor, cause: shape.createdCause === undefined ? 'user' : shape.createdCause, status: shape.createdStatus ?? 'open' })
  if (shape.followup) {
    rows.push(stepRow(caseId, {
      key: shape.followup.key,
      atMs: startMs + shape.followup.delayMs,
      actor: shape.followup.actor ?? actor,
      cause: shape.followup.cause === undefined ? 'user' : shape.followup.cause,
      sync: shape.followup.sync,
    }))
  }
  for (let owner = 0; owner < (shape.ownerChanges ?? 2); owner += 1) {
    rows.push(stepRow(caseId, {
      key: 'ownerUserId:changed',
      kind: 'followup',
      field: 'ownerUserId',
      value: `tk1:owner-${owner}`,
      atMs: startMs + 2 * HOUR_MS + owner * MINUTE_MS,
      actor,
    }))
  }
  return rows
}

export function dealCases(count: number, shape: (index: number) => DealShape, options: { debounceMs?: number; offset?: number } = {}): MiningCase[] {
  return Array.from({ length: count }, (_, position) => {
    const index = position + 1 + (options.offset ?? 0)
    return miningCaseOf(caseIdOf(index), dealRows(index, shape(index)), { debounceMs: options.debounceMs })
  })
}
