import { createHash } from 'node:crypto'
import {
  PROCESS_LEGACY_CAUSE_KIND,
  type ProcessCaseStatus,
} from '@open-mercato/shared/modules/insights/process'
import type { RegisteredProcess } from './registry'

export const CASE_EVENT_LIMIT = 500

export const AUTOMATED_CAUSE_KINDS: ReadonlySet<string> = new Set([
  'agent',
  'workflow',
  'business_rule',
  'ai_action',
  'ai_tool',
  'sync_run',
  'schedule',
  'subscriber',
  'system',
])

const VARIANT_ACTIVITY_KINDS: ReadonlySet<string> = new Set(['lifecycle', 'stage', 'milestone'])

const VARIANT_SEPARATOR = '\u001f'

/** Total order of a case's events: `(occurred_at, source_log_id, seq)`. */
export type CaseEventPosition = {
  occurredAt: string
  sourceLogId: string
  seq: number
}

export type CaseEventRow = CaseEventPosition & {
  activityKey: string
  activityKind: string
  actorPseudonym: string | null
  causeKind: string
  viaSyncRun: boolean
  followupField: string | null
  followupValue: string | null
}

/**
 * Exact whole-case figures of a case with more than `CASE_EVENT_LIMIT` events, computed by
 * the store with aggregates over every non-voided event: the counts, the latest event of
 * each stage field and the latest event of each lifecycle activity (`created`, `deleted`,
 * exits).
 */
export type CaseAggregate = {
  eventCount: number
  lastActivityAt: string
  distinctActorCount: number
  automatedCount: number
  legacyEvents: number
  syncRunEvents: number
  causeKinds: Record<string, number>
  latestStages: Array<CaseEventPosition & { field: string; value: string }>
  latestLifecycle: Array<CaseEventPosition & { key: string }>
}

export type CaseSummary = {
  startedAt: string
  lastActivityAt: string
  endedAt: string | null
  status: ProcessCaseStatus
  eventCount: number
  reworkCount: number
  distinctActorCount: number
  automatedShare: number
  variantKeys: string[]
  variantHash: string
  dimensions: {
    stages: Record<string, string>
    causeKinds: Record<string, number>
    legacyEvents: number
    syncRunEvents: number
  }
  truncated: boolean
}

function isTerminal(process: RegisteredProcess, stages: ReadonlyMap<string, string>): boolean {
  return process.endStates.some((endState) => {
    const value = stages.get(endState.field)
    return value !== undefined && endState.values.includes(value)
  })
}

function isoMicros(value: string): number {
  const micros = /\.\d{3}(\d{1,3})Z$/.exec(value)
  return Date.parse(value) * 1000 + (micros ? Number.parseInt(micros[1].padEnd(3, '0'), 10) : 0)
}

/** Orders two events of one case the way the projection does. */
export function compareCaseEventPositions(left: CaseEventPosition, right: CaseEventPosition): number {
  const leftAt = isoMicros(left.occurredAt)
  const rightAt = isoMicros(right.occurredAt)
  if (leftAt !== rightAt) return leftAt < rightAt ? -1 : 1
  if (left.sourceLogId !== right.sourceLogId) return left.sourceLogId < right.sourceLogId ? -1 : 1
  return left.seq - right.seq
}

function latestOf<TPosition extends CaseEventPosition>(positions: readonly TPosition[]): TPosition | null {
  let latest: TPosition | null = null
  for (const position of positions) {
    if (!latest || compareCaseEventPositions(position, latest) > 0) latest = position
  }
  return latest
}

export function computeVariantHash(keys: readonly string[]): string {
  return createHash('sha256').update(keys.join(VARIANT_SEPARATOR)).digest('hex')
}

type FinalState = {
  stages: Map<string, string>
  deletedAt: string | null
  endedByExitOrState: string | null
}

/**
 * Final state of a case from its exact aggregate. Equivalent to replaying every event: a
 * `created` clears an earlier deletion or exit, and only a change of an end-state field can
 * make a case terminal, so a terminal case ended with its latest end-state field change.
 */
function finalStateFromAggregate(process: RegisteredProcess, aggregate: CaseAggregate): FinalState {
  const stages = new Map(aggregate.latestStages.map((entry) => [entry.field, entry.value]))
  const created = latestOf(aggregate.latestLifecycle.filter((entry) => entry.key === 'created'))
  const deleted = latestOf(aggregate.latestLifecycle.filter((entry) => entry.key === 'deleted'))
  const exitKeys = new Set(process.exits.map((exit) => exit.key))
  const exited = latestOf(aggregate.latestLifecycle.filter((entry) => exitKeys.has(entry.key)))
  const after = (position: CaseEventPosition | null) =>
    position !== null && (!created || compareCaseEventPositions(position, created) > 0)
  const endStateFields = new Set(process.endStates.map((endState) => endState.field))
  const decided = latestOf(aggregate.latestStages.filter((entry) => endStateFields.has(entry.field)))
  const completedAt = isTerminal(process, stages) && decided ? decided.occurredAt : null
  return {
    stages,
    deletedAt: after(deleted) && deleted ? deleted.occurredAt : null,
    endedByExitOrState: (after(exited) && exited ? exited.occurredAt : null) ?? completedAt,
  }
}

/**
 * Builds the exact aggregate of a case from all of its non-voided events (pure; the store
 * computes the same figures in SQL). `events` may be in any order.
 */
export function buildCaseAggregate(events: readonly CaseEventRow[]): CaseAggregate | null {
  if (events.length === 0) return null
  const actors = new Set<string>()
  const causeKinds: Record<string, number> = {}
  const latestStages = new Map<string, CaseEventPosition & { field: string; value: string }>()
  const latestLifecycle = new Map<string, CaseEventPosition & { key: string }>()
  let last: CaseEventRow | null = null
  let automatedCount = 0
  let legacyEvents = 0
  let syncRunEvents = 0
  for (const event of events) {
    if (!last || compareCaseEventPositions(event, last) > 0) last = event
    if (event.actorPseudonym) actors.add(event.actorPseudonym)
    causeKinds[event.causeKind] = (causeKinds[event.causeKind] ?? 0) + 1
    if (AUTOMATED_CAUSE_KINDS.has(event.causeKind)) automatedCount += 1
    if (event.causeKind === PROCESS_LEGACY_CAUSE_KIND) legacyEvents += 1
    if (event.viaSyncRun) syncRunEvents += 1
    const position = { occurredAt: event.occurredAt, sourceLogId: event.sourceLogId, seq: event.seq }
    if (event.activityKind === 'stage' && event.followupField && event.followupValue !== null) {
      const current = latestStages.get(event.followupField)
      if (!current || compareCaseEventPositions(position, current) > 0) {
        latestStages.set(event.followupField, { ...position, field: event.followupField, value: event.followupValue })
      }
    }
    if (event.activityKind === 'lifecycle') {
      const current = latestLifecycle.get(event.activityKey)
      if (!current || compareCaseEventPositions(position, current) > 0) {
        latestLifecycle.set(event.activityKey, { ...position, key: event.activityKey })
      }
    }
  }
  return {
    eventCount: events.length,
    lastActivityAt: last ? last.occurredAt : events[0].occurredAt,
    distinctActorCount: actors.size,
    automatedCount,
    legacyEvents,
    syncRunEvents,
    causeKinds,
    latestStages: Array.from(latestStages.values()),
    latestLifecycle: Array.from(latestLifecycle.values()),
  }
}

/**
 * Summarizes one case (pure). `events` are its first non-voided events in chronological
 * order; at most `CASE_EVENT_LIMIT` of them are read. When the case has more events the
 * caller passes their exact `aggregate`: counts, last activity, status, end time, actors,
 * cause kinds and current stages then cover the whole case, while the variant and the rework
 * count cover the first `CASE_EVENT_LIMIT` events (`truncated`). A case ends when it is
 * deleted, when one of the process's exits happens, or when a stage field reaches a declared
 * end state; reopening it clears `endedAt`. Rework counts re-entries into a stage activity
 * already visited.
 */
export function summarizeCase(
  process: RegisteredProcess,
  events: readonly CaseEventRow[],
  aggregate: CaseAggregate | null = null,
): CaseSummary | null {
  const window = events.slice(0, CASE_EVENT_LIMIT)
  if (window.length === 0) return null
  const stages = new Map<string, string>()
  const visitedStages = new Set<string>()
  const actors = new Set<string>()
  const causeKinds: Record<string, number> = {}
  const variantKeys: string[] = []
  let reworkCount = 0
  let automated = 0
  let legacyEvents = 0
  let syncRunEvents = 0
  const exitKeys = new Set(process.exits.map((exit) => exit.key))
  let deletedAt: string | null = null
  let exitedAt: string | null = null
  let completedAt: string | null = null
  let previousStageKey: string | null = null
  for (const event of window) {
    if (event.actorPseudonym) actors.add(event.actorPseudonym)
    causeKinds[event.causeKind] = (causeKinds[event.causeKind] ?? 0) + 1
    if (AUTOMATED_CAUSE_KINDS.has(event.causeKind)) automated += 1
    if (event.causeKind === PROCESS_LEGACY_CAUSE_KIND) legacyEvents += 1
    if (event.viaSyncRun) syncRunEvents += 1
    if (VARIANT_ACTIVITY_KINDS.has(event.activityKind) && variantKeys[variantKeys.length - 1] !== event.activityKey) {
      variantKeys.push(event.activityKey)
    }
    if (event.activityKind === 'lifecycle') {
      if (event.activityKey === 'deleted') deletedAt = event.occurredAt
      if (event.activityKey === 'created') {
        deletedAt = null
        exitedAt = null
      }
      if (exitKeys.has(event.activityKey)) exitedAt = event.occurredAt
    }
    if (event.activityKind === 'stage' && event.followupField && event.followupValue !== null) {
      if (event.activityKey !== previousStageKey && visitedStages.has(event.activityKey)) reworkCount += 1
      visitedStages.add(event.activityKey)
      previousStageKey = event.activityKey
      const field = event.followupField
      const wasTerminal = isTerminal(process, stages)
      stages.set(field, event.followupValue)
      const nowTerminal = isTerminal(process, stages)
      const decidesEndState = process.endStates.some((endState) => endState.field === field)
      if (nowTerminal && (!wasTerminal || decidesEndState)) completedAt = event.occurredAt
      if (!nowTerminal) completedAt = null
    }
  }
  const variant = { variantKeys, variantHash: computeVariantHash(variantKeys), reworkCount, startedAt: window[0].occurredAt }
  if (aggregate) {
    const final = finalStateFromAggregate(process, aggregate)
    return {
      ...variant,
      lastActivityAt: aggregate.lastActivityAt,
      endedAt: final.deletedAt ?? final.endedByExitOrState,
      status: final.deletedAt ? 'deleted' : final.endedByExitOrState ? 'completed' : 'open',
      eventCount: aggregate.eventCount,
      distinctActorCount: aggregate.distinctActorCount,
      automatedShare: aggregate.eventCount > 0 ? Math.round((aggregate.automatedCount / aggregate.eventCount) * 10000) / 10000 : 0,
      dimensions: {
        stages: Object.fromEntries(final.stages),
        causeKinds: aggregate.causeKinds,
        legacyEvents: aggregate.legacyEvents,
        syncRunEvents: aggregate.syncRunEvents,
      },
      truncated: aggregate.eventCount > window.length,
    }
  }
  const endedByExitOrState = exitedAt ?? completedAt
  return {
    ...variant,
    lastActivityAt: window[window.length - 1].occurredAt,
    endedAt: deletedAt ?? endedByExitOrState,
    status: deletedAt ? 'deleted' : endedByExitOrState ? 'completed' : 'open',
    eventCount: events.length,
    distinctActorCount: actors.size,
    automatedShare: Math.round((automated / window.length) * 10000) / 10000,
    dimensions: {
      stages: Object.fromEntries(stages),
      causeKinds,
      legacyEvents,
      syncRunEvents,
    },
    truncated: events.length > window.length,
  }
}
