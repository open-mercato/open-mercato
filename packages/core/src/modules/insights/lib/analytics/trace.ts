import { PROCESS_LEGACY_CAUSE_KIND } from '@open-mercato/shared/modules/insights/process'
import { AUTOMATED_CAUSE_KINDS, summarizeCase, type CaseEventRow } from '../process/caseSummary'
import type { RegisteredProcess } from '../process/registry'
import { isInWindow, type ResolvedWindow } from './window'
import type { AnalyticsFilters, CauseCounts } from './types'

export type CauseClass = 'human' | 'automated' | 'legacy' | 'other'

export type CaseStatusAsOf = 'open' | 'completed' | 'deleted'

export const SYNC_RUN_CAUSE_KIND = 'sync_run'

const HUMAN_CAUSE_KIND = 'user'

const COLLAPSIBLE_ACTIVITY_KINDS: ReadonlySet<string> = new Set(['stage', 'followup', 'milestone'])

const VARIANT_ACTIVITY_KINDS: ReadonlySet<string> = new Set(['lifecycle', 'stage', 'milestone'])

/** A projected event as read by the analytics queries (identifiers only). */
export type AnalyticsEventRow = {
  organizationId: string
  caseId: string
  activityKey: string
  activityKind: string
  occurredAt: string
  sourceLogId: string
  seq: number
  actorPseudonym: string | null
  actorRoleIds: string[] | null
  actorTeamId: string | null
  causeKind: string | null
  viaSyncRun: boolean
  followupField: string | null
  followupValue: string | null
}

/**
 * The stored case summary: start, end and status for cases whose history is longer than the
 * per-case read, and the stored `variant_hash` (the drill-down key of `listCases`).
 */
export type CaseRowSummary = {
  startedAt: string | null
  endedAt: string | null
  status: string | null
  variantHash: string | null
}

export type AnalyticsEvent = {
  index: number
  activityKey: string
  activityKind: string
  occurredAt: string
  atMs: number
  sourceLogId: string
  seq: number
  actor: string | null
  roleIds: string[]
  teamId: string | null
  causeKind: string
  causeClass: CauseClass
  sync: boolean
  field: string | null
  value: string | null
  initial: boolean
  inWindow: boolean
}

/**
 * The non-voided events of one case up to the window end, in projection order. `complete`
 * means the history starts at the case's first event (no per-case truncation); the status is
 * the case's status as of the window end.
 */
export type CaseTrace = {
  organizationId: string
  caseId: string
  events: AnalyticsEvent[]
  complete: boolean
  startedAt: string | null
  startedAtMs: number | null
  endedAt: string | null
  endedAtMs: number | null
  status: CaseStatusAsOf
  storedVariantHash: string | null
}

export type CorrectionGroup = {
  field: string
  activityKey: string
  atMs: number
  inWindow: boolean
  events: AnalyticsEvent[]
}

export type CollapsedCase = {
  kept: AnalyticsEvent[]
  debounced: AnalyticsEvent[]
  corrections: CorrectionGroup[]
}

export type PreparedCase = {
  trace: CaseTrace
  collapsed: AnalyticsEvent[]
  filteredRaw: AnalyticsEvent[]
  filteredCollapsed: AnalyticsEvent[]
  filteredDebounced: AnalyticsEvent[]
  filteredCorrections: CorrectionGroup[]
  touchesWindow: boolean
}

/** `cause_kind` of a row, with rows recorded before causation tracking bucketed as `legacy`. */
export function normalizeCauseKind(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : PROCESS_LEGACY_CAUSE_KIND
}

/** Human steps are `user` rows only: `legacy` rows are never counted as human. */
export function classifyCause(causeKind: string): CauseClass {
  if (causeKind === HUMAN_CAUSE_KIND) return 'human'
  if (causeKind === PROCESS_LEGACY_CAUSE_KIND) return 'legacy'
  if (AUTOMATED_CAUSE_KINDS.has(causeKind)) return 'automated'
  return 'other'
}

export function emptyCauseCounts(): CauseCounts {
  return { human: 0, automated: 0, legacy: 0, other: 0, byKind: {} }
}

export function addCause(counts: CauseCounts, event: Pick<AnalyticsEvent, 'causeKind' | 'causeClass'>): void {
  counts[event.causeClass] += 1
  counts.byKind[event.causeKind] = (counts.byKind[event.causeKind] ?? 0) + 1
}

function parseIsoMs(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function toCaseEventRow(row: AnalyticsEventRow): CaseEventRow {
  return {
    activityKey: row.activityKey,
    activityKind: row.activityKind,
    occurredAt: row.occurredAt,
    sourceLogId: row.sourceLogId,
    seq: row.seq,
    actorPseudonym: row.actorPseudonym,
    causeKind: normalizeCauseKind(row.causeKind),
    viaSyncRun: row.viaSyncRun,
    followupField: row.followupField,
    followupValue: row.followupValue,
  }
}

function readStatus(value: string | null): CaseStatusAsOf {
  return value === 'completed' || value === 'deleted' ? value : 'open'
}

function isCreation(row: AnalyticsEventRow): boolean {
  if (row.activityKind === 'lifecycle') return row.activityKey === 'created'
  return row.activityKind === 'milestone' && row.activityKey.endsWith('.created')
}

function toEvents(rows: readonly AnalyticsEventRow[], window: Pick<ResolvedWindow, 'fromMs' | 'toMs'>): AnalyticsEvent[] {
  const creations = new Set(rows.filter(isCreation).map((row) => row.sourceLogId))
  return rows.map((row, index) => {
    const causeKind = normalizeCauseKind(row.causeKind)
    const atMs = parseIsoMs(row.occurredAt)
    return {
      index,
      activityKey: row.activityKey,
      activityKind: row.activityKind,
      occurredAt: row.occurredAt,
      atMs,
      sourceLogId: row.sourceLogId,
      seq: row.seq,
      actor: row.actorPseudonym,
      roleIds: Array.isArray(row.actorRoleIds) ? row.actorRoleIds : [],
      teamId: row.actorTeamId,
      causeKind,
      causeClass: classifyCause(causeKind),
      sync: row.viaSyncRun || causeKind === SYNC_RUN_CAUSE_KIND,
      field: row.followupField,
      value: row.followupValue,
      initial: creations.has(row.sourceLogId),
      inWindow: isInWindow(atMs, window),
    }
  })
}

/**
 * Builds the trace of one case from its most recent `perCaseLimit + 1` events before the
 * window end (ascending). More than `perCaseLimit` events means the history is cut: the
 * oldest row is dropped, the trace is incomplete and the stored case summary supplies the
 * start and (when it ended before the window end) the end. A complete trace is summarized
 * as of the window end with the projection's own case rules.
 */
export function buildCaseTrace(input: {
  organizationId: string
  caseId: string
  rows: readonly AnalyticsEventRow[]
  caseRow: CaseRowSummary | null
  process: RegisteredProcess
  window: Pick<ResolvedWindow, 'fromMs' | 'toMs'>
  perCaseLimit: number
}): CaseTrace {
  const beforeEnd = input.rows.filter((row) => parseIsoMs(row.occurredAt) < input.window.toMs)
  const complete = beforeEnd.length <= input.perCaseLimit
  const rows = complete ? beforeEnd : beforeEnd.slice(beforeEnd.length - input.perCaseLimit)
  const events = toEvents(rows, input.window)
  const storedVariantHash = input.caseRow?.variantHash ?? null
  if (complete && rows.length > 0) {
    const summary = summarizeCase(input.process, rows.map(toCaseEventRow))
    if (summary) {
      return {
        organizationId: input.organizationId,
        caseId: input.caseId,
        events,
        complete: true,
        startedAt: summary.startedAt,
        startedAtMs: parseIsoMs(summary.startedAt),
        endedAt: summary.endedAt,
        endedAtMs: summary.endedAt ? parseIsoMs(summary.endedAt) : null,
        status: summary.status,
        storedVariantHash,
      }
    }
  }
  const startedAt = input.caseRow?.startedAt ?? rows[0]?.occurredAt ?? null
  const storedEnd = input.caseRow?.endedAt ?? null
  const storedEndMs = storedEnd ? parseIsoMs(storedEnd) : Number.NaN
  const endedBeforeWindowEnd = Number.isFinite(storedEndMs) && storedEndMs < input.window.toMs
  return {
    organizationId: input.organizationId,
    caseId: input.caseId,
    events,
    complete: false,
    startedAt,
    startedAtMs: startedAt ? parseIsoMs(startedAt) : null,
    endedAt: endedBeforeWindowEnd ? storedEnd : null,
    endedAtMs: endedBeforeWindowEnd ? storedEndMs : null,
    status: endedBeforeWindowEnd ? readStatus(input.caseRow?.status ?? null) : 'open',
    storedVariantHash,
  }
}

type Burst = {
  actor: string
  causeKind: string
  firstAtMs: number
  valueBefore: string | null | undefined
  events: AnalyticsEvent[]
}

function isCollapsible(event: AnalyticsEvent): event is AnalyticsEvent & { actor: string } {
  return event.actor !== null && event.causeClass !== 'automated' && !event.initial
}

/**
 * Query-time debounce and correction collapse (X4) of one case's events, per field. A burst
 * is a run of changes of one field by the same actor with the same cause kind, all within
 * `debounceMs` of its first change, and not interrupted by another change of the field. A
 * burst that ends on the value the field had before it is a correction (`A→B→A`): all of its
 * events are dropped. Any other burst keeps only its last (settled) change. Automated steps,
 * steps without an actor and the initial values of a creation never collapse.
 */
export function collapseCaseEvents(events: readonly AnalyticsEvent[], debounceMs: number): CollapsedCase {
  if (!(debounceMs > 0)) return { kept: [...events], debounced: [], corrections: [] }
  const dropped = new Map<number, 'debounced' | 'corrected'>()
  const corrections: CorrectionGroup[] = []
  const settled = new Map<string, string | null>()
  const open = new Map<string, Burst>()
  const close = (field: string) => {
    const burst = open.get(field)
    if (!burst) return
    open.delete(field)
    const last = burst.events[burst.events.length - 1]
    if (burst.events.length >= 2 && burst.valueBefore !== undefined && last.value === burst.valueBefore) {
      for (const event of burst.events) dropped.set(event.index, 'corrected')
      const first = burst.events[0]
      corrections.push({ field, activityKey: first.activityKey, atMs: first.atMs, inWindow: first.inWindow, events: burst.events })
      return
    }
    for (const event of burst.events.slice(0, -1)) dropped.set(event.index, 'debounced')
    settled.set(field, last.value)
  }
  for (const event of events) {
    if (!event.field || !COLLAPSIBLE_ACTIVITY_KINDS.has(event.activityKind)) continue
    const field = event.field
    const burst = open.get(field)
    if (
      burst
      && isCollapsible(event)
      && event.actor === burst.actor
      && event.causeKind === burst.causeKind
      && event.atMs - burst.firstAtMs <= debounceMs
    ) {
      burst.events.push(event)
      continue
    }
    close(field)
    if (isCollapsible(event)) {
      open.set(field, {
        actor: event.actor,
        causeKind: event.causeKind,
        firstAtMs: event.atMs,
        valueBefore: settled.has(field) ? settled.get(field) ?? null : undefined,
        events: [event],
      })
    } else {
      settled.set(field, event.value)
    }
  }
  for (const field of Array.from(open.keys())) close(field)
  return {
    kept: events.filter((event) => !dropped.has(event.index)),
    debounced: events.filter((event) => dropped.get(event.index) === 'debounced'),
    corrections,
  }
}

export function matchesFilters(event: AnalyticsEvent, filters: AnalyticsFilters): boolean {
  if (filters.causeKinds && !filters.causeKinds.includes(event.causeKind)) return false
  if (filters.actorRoleIds && !event.roleIds.some((roleId) => filters.actorRoleIds?.includes(roleId))) return false
  if (filters.actorTeamIds && (event.teamId === null || !filters.actorTeamIds.includes(event.teamId))) return false
  return true
}

export function prepareCase(trace: CaseTrace, debounceMs: number, filters: AnalyticsFilters): PreparedCase {
  const collapsed = collapseCaseEvents(trace.events, debounceMs)
  const matches = (event: AnalyticsEvent) => matchesFilters(event, filters)
  const filteredRaw = trace.events.filter(matches)
  return {
    trace,
    collapsed: collapsed.kept,
    filteredRaw,
    filteredCollapsed: collapsed.kept.filter(matches),
    filteredDebounced: collapsed.debounced.filter(matches),
    filteredCorrections: collapsed.corrections.filter((group) => matches(group.events[0])),
    touchesWindow: filteredRaw.some((event) => event.inWindow),
  }
}

/** Activity keys of a trace's variant: lifecycle, stage and milestone steps, repeats merged. */
export function variantKeysOf(events: readonly AnalyticsEvent[]): string[] {
  const keys: string[] = []
  for (const event of events) {
    if (!VARIANT_ACTIVITY_KINDS.has(event.activityKind)) continue
    if (keys[keys.length - 1] !== event.activityKey) keys.push(event.activityKey)
  }
  return keys
}

/** Whether the case completed (as of the window end) inside the window. */
export function completedInWindow(prepared: PreparedCase, window: Pick<ResolvedWindow, 'fromMs' | 'toMs'>): boolean {
  const trace = prepared.trace
  return trace.status === 'completed'
    && trace.endedAtMs !== null
    && isInWindow(trace.endedAtMs, window)
    && prepared.filteredRaw.length > 0
}

export type CycleTime = {
  ms: number
  sync: boolean
}

/**
 * Cycle time of a completed case: from its start to its end. It is a `sync_run` duration when
 * the event that started or ended the case came through a sync run (import timestamps, not
 * business time); the start event is only known for a complete trace.
 */
export function cycleTimeOf(trace: CaseTrace): CycleTime | null {
  if (trace.startedAtMs === null || trace.endedAtMs === null) return null
  if (!Number.isFinite(trace.startedAtMs) || !Number.isFinite(trace.endedAtMs)) return null
  const startEvent = trace.complete ? trace.events[0] ?? null : null
  let endEvent: AnalyticsEvent | null = null
  for (const event of trace.events) {
    if (event.occurredAt === trace.endedAt) endEvent = event
  }
  return {
    ms: Math.max(0, trace.endedAtMs - trace.startedAtMs),
    sync: Boolean(startEvent?.sync) || Boolean(endEvent?.sync),
  }
}

export function distinctCount(values: Iterable<string | null>): number {
  const set = new Set<string>()
  for (const value of values) if (value !== null) set.add(value)
  return set.size
}
