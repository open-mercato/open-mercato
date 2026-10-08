import { testRegistry } from '../../process/__tests__/processTestSupport'
import type { BuildContext } from '../envelope'
import { buildCaseTrace, prepareCase, type AnalyticsEventRow, type PreparedCase } from '../trace'
import type { ResolvedWindow } from '../window'
import type { AnalyticsFilters } from '../types'

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export const BASE_MS = Date.UTC(2026, 0, 5, 9, 0, 0)

export const ANALYTICS_ORG = '22222222-0000-4000-8000-000000000001'
export const ANALYTICS_OTHER_ORG = '22222222-0000-4000-8000-000000000002'

export const dealProcess = testRegistry().processes[0]

let logSequence = 0

export function nextSourceLogId(): string {
  logSequence += 1
  return `88888888-0000-4000-8000-${String(logSequence).padStart(12, '0')}`
}

export function caseIdOf(index: number): string {
  return `44444444-0000-4000-8000-${String(index).padStart(12, '0')}`
}

export function actorOf(index: number): string {
  return `tk1:actor-${index}`
}

export type StepSpec = {
  key: string
  kind?: string
  atMs: number
  actor?: string | null
  cause?: string | null
  field?: string | null
  value?: string | null
  sync?: boolean
  sourceLogId?: string
  seq?: number
  roleIds?: string[] | null
  teamId?: string | null
}

export function stepRow(caseId: string, spec: StepSpec, organizationId: string = ANALYTICS_ORG): AnalyticsEventRow {
  const [field, value] = spec.key.includes(':') ? spec.key.split(':') : [null, null]
  return {
    organizationId,
    caseId,
    activityKey: spec.key,
    activityKind: spec.kind ?? (spec.key === 'created' || spec.key === 'deleted' ? 'lifecycle' : 'stage'),
    occurredAt: new Date(spec.atMs).toISOString(),
    sourceLogId: spec.sourceLogId ?? nextSourceLogId(),
    seq: spec.seq ?? 0,
    actorPseudonym: spec.actor === undefined ? actorOf(1) : spec.actor,
    actorRoleIds: spec.roleIds ?? null,
    actorTeamId: spec.teamId ?? null,
    causeKind: spec.cause === undefined ? 'user' : spec.cause,
    viaSyncRun: spec.sync === true,
    followupField: spec.field !== undefined ? spec.field : field,
    followupValue: spec.value !== undefined ? spec.value : value,
  }
}

/** A creation row (`created` + the initial `status:<value>` from the same audit row). */
export function creation(caseId: string, atMs: number, options: { status?: string; actor?: string | null; cause?: string | null; sync?: boolean } = {}, organizationId: string = ANALYTICS_ORG): AnalyticsEventRow[] {
  const sourceLogId = nextSourceLogId()
  const shared = { atMs, actor: options.actor, cause: options.cause, sync: options.sync, sourceLogId }
  return [
    stepRow(caseId, { ...shared, key: 'created', kind: 'lifecycle', field: null, value: null, seq: 0 }, organizationId),
    stepRow(caseId, { ...shared, key: `status:${options.status ?? 'open'}`, seq: 1 }, organizationId),
  ]
}

export function windowOf(fromMs: number, toMs: number, timeZone = 'UTC'): ResolvedWindow {
  return { fromMs, toMs, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), windowKey: null, timeZone }
}

export function prepareRows(
  caseId: string,
  rows: AnalyticsEventRow[],
  window: ResolvedWindow,
  options: { debounceMs?: number; filters?: AnalyticsFilters; organizationId?: string } = {},
): PreparedCase {
  const sorted = [...rows].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
    || left.sourceLogId.localeCompare(right.sourceLogId)
    || left.seq - right.seq)
  const trace = buildCaseTrace({
    organizationId: options.organizationId ?? ANALYTICS_ORG,
    caseId,
    rows: sorted,
    caseRow: null,
    process: dealProcess,
    window,
    perCaseLimit: 500,
  })
  return prepareCase(trace, options.debounceMs ?? 120_000, options.filters ?? {})
}

export function buildContext(window: ResolvedWindow, options: { k?: number; includeSyncRun?: boolean } = {}): BuildContext {
  const k = options.k ?? 5
  return {
    window,
    k,
    includeSyncRun: options.includeSyncRun === true,
    envelope: {
      processKey: dealProcess.processKey,
      organizationIds: [ANALYTICS_ORG],
      window: { from: window.from, to: window.to, windowKey: window.windowKey, timeZone: window.timeZone },
      computedThrough: null,
      kAnonymity: k,
      source: 'live',
    },
  }
}
