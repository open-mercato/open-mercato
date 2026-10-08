import { buildEnvelope, type BuildContext } from './envelope'
import { createSuppressionTally, rate, suppressionReason, wilsonLowerBound } from './stats'
import type { AnalyticsEvent, PreparedCase } from './trace'
import type { ReworkResult } from './types'

type StageCell = {
  activityKey: string
  rework: number
  reworkRaw: number
  corrections: number
  cases: Set<string>
  actors: Set<string>
}

/**
 * Re-entries of a stage field into a value it already had after having left it (per field),
 * over the case's whole history. Computed on the unfiltered sequence so that a filter never
 * hides the departure from a stage.
 */
export function reworkOccurrences(sequence: readonly AnalyticsEvent[]): AnalyticsEvent[] {
  const visited = new Map<string, Set<string>>()
  const current = new Map<string, string>()
  const occurrences: AnalyticsEvent[] = []
  for (const event of sequence) {
    if (event.activityKind !== 'stage' || !event.field || event.value === null) continue
    const seen = visited.get(event.field) ?? new Set<string>()
    visited.set(event.field, seen)
    if (current.get(event.field) !== event.value && seen.has(event.value)) occurrences.push(event)
    seen.add(event.value)
    current.set(event.field, event.value)
  }
  return occurrences
}

/**
 * Rework versus correction. Rework is a genuine return to an earlier stage; a correction is a
 * quick `A→B→A` by the same actor inside the debounce window, which the collapse removes
 * (X4). `reworkRaw` counts re-entries before collapse (corrections included), `rework` after
 * it; `corrections` and `debounced` count what the collapse removed in the window. Only
 * re-entries whose event lies in the window and matches the filters count.
 */
export function buildRework(cases: readonly PreparedCase[], context: BuildContext): ReworkResult {
  const population = cases.filter((prepared) => prepared.touchesWindow)
  const cells = new Map<string, StageCell>()
  const totals = { rework: 0, reworkRaw: 0, corrections: 0, debounced: 0 }
  let casesWithRework = 0
  let casesWithReworkRaw = 0
  let truncatedCases = 0
  const cellFor = (activityKey: string): StageCell => {
    const existing = cells.get(activityKey)
    if (existing) return existing
    const created: StageCell = { activityKey, rework: 0, reworkRaw: 0, corrections: 0, cases: new Set(), actors: new Set() }
    cells.set(activityKey, created)
    return created
  }
  for (const prepared of population) {
    if (!prepared.trace.complete) truncatedCases += 1
    const caseKey = `${prepared.trace.organizationId}:${prepared.trace.caseId}`
    const matching = new Set(prepared.filteredRaw.map((event) => event.index))
    const counted = (event: AnalyticsEvent) => event.inWindow && matching.has(event.index)
    const collapsed = reworkOccurrences(prepared.collapsed).filter(counted)
    const raw = reworkOccurrences(prepared.trace.events).filter(counted)
    for (const event of collapsed) {
      const cell = cellFor(event.activityKey)
      cell.rework += 1
      cell.cases.add(caseKey)
      if (event.actor) cell.actors.add(event.actor)
    }
    for (const event of raw) {
      const cell = cellFor(event.activityKey)
      cell.reworkRaw += 1
      cell.cases.add(caseKey)
      if (event.actor) cell.actors.add(event.actor)
    }
    for (const group of prepared.filteredCorrections) {
      if (!group.inWindow) continue
      const cell = cellFor(group.activityKey)
      cell.corrections += 1
      cell.cases.add(caseKey)
      for (const event of group.events) if (event.actor) cell.actors.add(event.actor)
      totals.corrections += 1
    }
    totals.rework += collapsed.length
    totals.reworkRaw += raw.length
    totals.debounced += prepared.filteredDebounced.filter((event) => event.inWindow).length
    if (collapsed.length > 0) casesWithRework += 1
    if (raw.length > 0) casesWithReworkRaw += 1
  }
  const tally = createSuppressionTally()
  const byStage: ReworkResult['byStage'] = []
  for (const cell of cells.values()) {
    const reason = suppressionReason({ cases: cell.cases.size, actors: cell.actors.size }, context.k)
    if (reason) {
      tally.record(reason)
      continue
    }
    byStage.push({ activityKey: cell.activityKey, rework: cell.rework, reworkRaw: cell.reworkRaw, corrections: cell.corrections, cases: cell.cases.size })
  }
  byStage.sort((left, right) => right.rework - left.rework || right.reworkRaw - left.reworkRaw || left.activityKey.localeCompare(right.activityKey))
  const n = population.length
  return {
    ...buildEnvelope(context.envelope, n, tally.summary()),
    ...totals,
    casesWithRework,
    casesWithReworkRaw,
    reworkRate: rate(casesWithRework, n),
    reworkRateLowerBound: wilsonLowerBound(casesWithRework, n),
    truncatedCases,
    byStage,
  }
}
