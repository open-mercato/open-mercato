import { buildEnvelope, type BuildContext } from './envelope'
import { createSuppressionTally, summarizeDurations, suppressCells } from './stats'
import type { PreparedCase } from './trace'
import { XRAY_ANALYTICS_LIMITS, XRAY_STATS_GUARDS, type BottlenecksResult, type DurationStats } from './types'

type WaitCell = {
  key: string
  from: string
  to: string
  transitions: number
  rawTransitions: number
  excludedSyncRun: number
  cases: Set<string>
  actors: Set<string>
  waits: number[]
}

function compareNullableDesc(left: number | null, right: number | null): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}

function compareWaits(left: { wait: DurationStats; transitions: number }, right: { wait: DurationStats; transitions: number }): number {
  return compareNullableDesc(left.wait.medianMs, right.wait.medianMs)
    || compareNullableDesc(left.wait.p90Ms, right.wait.p90Ms)
    || right.transitions - left.transitions
}

/**
 * Waiting time per transition of the collapsed sequences: the time from a step to the next
 * one, attributed to the transition whose target lies in the window (each item also carries
 * how often the same pair followed each other before the collapse). Transitions touching a
 * `sync_run` step are excluded from the duration statistics (but still counted) unless
 * requested. `totalWaitMs` needs as many measured waits as a median (5). Ranked by guarded
 * median wait, then p90, then volume. Transition cells are suppressed under the k /
 * distinct-actor thresholds with complementary suppression; once one is suppressed, the
 * `transitions` totals are sums over the visible items only.
 */
export function buildBottlenecks(cases: readonly PreparedCase[], context: BuildContext): BottlenecksResult {
  const population = cases.filter((prepared) => prepared.touchesWindow)
  const cells = new Map<string, WaitCell>()
  const rawCounts = new Map<string, number>()
  let raw = 0
  let collapsed = 0
  let measured = 0
  let excludedSyncRun = 0
  for (const prepared of population) {
    const caseKey = `${prepared.trace.organizationId}:${prepared.trace.caseId}`
    const rawSequence = prepared.filteredRaw
    for (let position = 1; position < rawSequence.length; position += 1) {
      if (!rawSequence[position].inWindow) continue
      const key = JSON.stringify([rawSequence[position - 1].activityKey, rawSequence[position].activityKey])
      rawCounts.set(key, (rawCounts.get(key) ?? 0) + 1)
      raw += 1
    }
    const sequence = prepared.filteredCollapsed
    for (let position = 1; position < sequence.length; position += 1) {
      const target = sequence[position]
      if (!target.inWindow) continue
      const source = sequence[position - 1]
      const key = JSON.stringify([source.activityKey, target.activityKey])
      const cell = cells.get(key) ?? {
        key,
        from: source.activityKey,
        to: target.activityKey,
        transitions: 0,
        rawTransitions: 0,
        excludedSyncRun: 0,
        cases: new Set<string>(),
        actors: new Set<string>(),
        waits: [],
      }
      cells.set(key, cell)
      collapsed += 1
      cell.transitions += 1
      cell.cases.add(caseKey)
      if (target.actor) cell.actors.add(target.actor)
      if (!context.includeSyncRun && (source.sync || target.sync)) {
        excludedSyncRun += 1
        cell.excludedSyncRun += 1
        continue
      }
      cell.waits.push(Math.max(0, target.atMs - source.atMs))
      measured += 1
    }
  }
  for (const cell of cells.values()) cell.rawTransitions = rawCounts.get(cell.key) ?? 0
  const tally = createSuppressionTally()
  const outcome = suppressCells(Array.from(cells.values()), (cell) => ({ key: cell.key, cases: cell.cases, actors: cell.actors }), context.k, tally)
  const items: BottlenecksResult['items'] = outcome.visible.map((cell) => ({
    from: cell.from,
    to: cell.to,
    transitions: cell.transitions,
    rawTransitions: cell.rawTransitions,
    cases: cell.cases.size,
    wait: summarizeDurations(cell.waits),
    totalWaitMs: cell.waits.length >= XRAY_STATS_GUARDS.minMedianN ? cell.waits.reduce((total, wait) => total + wait, 0) : null,
  }))
  items.sort((left, right) => compareWaits(left, right) || left.from.localeCompare(right.from) || left.to.localeCompare(right.to))
  const shown = items.slice(0, XRAY_ANALYTICS_LIMITS.maxBottlenecks)
  const sum = (pick: (cell: WaitCell) => number) => outcome.visible.reduce((total, cell) => total + pick(cell), 0)
  const transitions = outcome.anySuppressed
    ? {
      raw: sum((cell) => cell.rawTransitions),
      collapsed: sum((cell) => cell.transitions),
      measured: sum((cell) => cell.waits.length),
      excludedSyncRun: sum((cell) => cell.excludedSyncRun),
    }
    : { raw, collapsed, measured, excludedSyncRun }
  return {
    ...buildEnvelope(context.envelope, population.length, tally.summary()),
    includeSyncRun: context.includeSyncRun,
    transitions,
    items: shown,
    omitted: items.length - shown.length,
  }
}
