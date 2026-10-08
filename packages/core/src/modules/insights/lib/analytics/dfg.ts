import { buildEnvelope, type BuildContext } from './envelope'
import { createSuppressionTally, suppressionReason } from './stats'
import { addCause, emptyCauseCounts, type AnalyticsEvent, type PreparedCase } from './trace'
import { isInWindow } from './window'
import {
  XRAY_ANALYTICS_LIMITS,
  XRAY_MAP_END,
  XRAY_MAP_START,
  type CauseCounts,
  type ProcessMapResult,
} from './types'

type SequenceMode = 'raw' | 'collapsed'

type MapCell = {
  raw: number
  collapsed: number
  cases: Set<string>
  actors: Set<string>
  causes: CauseCounts
}

type NodeCell = MapCell & { activityKey: string; activityKind: string }

type EdgeCell = MapCell & { from: string; to: string }

function emptyCell(): MapCell {
  return { raw: 0, collapsed: 0, cases: new Set(), actors: new Set(), causes: emptyCauseCounts() }
}

function caseKeyOf(prepared: PreparedCase): string {
  return `${prepared.trace.organizationId}:${prepared.trace.caseId}`
}

function compareCells(left: MapCell, right: MapCell): number {
  if (left.collapsed !== right.collapsed) return right.collapsed - left.collapsed
  return right.raw - left.raw
}

/**
 * Directly-follows graph of the window. A transition counts when its target event lies in the
 * window (its source may be earlier in the case). Every node and edge carries both the raw
 * count and the count after debounce/correction collapse (X4), and the cause kinds of its
 * collapsed target events (X6: automated steps stay in the graph, `legacy` is never human).
 * `__start__` edges come from complete traces only; `__end__` edges from cases that completed
 * or were deleted in the window. Cells under the k-anonymity / distinct-actor thresholds are
 * suppressed.
 */
export function buildProcessMap(cases: readonly PreparedCase[], context: BuildContext): ProcessMapResult {
  const population = cases.filter((prepared) => prepared.touchesWindow)
  const nodes = new Map<string, NodeCell>()
  const edges = new Map<string, EdgeCell>()
  const totals = { raw: 0, collapsed: 0, debounced: 0, corrected: 0 }
  const started = new Set<string>()
  const ended = new Set<string>()
  let truncatedCases = 0

  const nodeFor = (event: AnalyticsEvent): NodeCell => {
    const existing = nodes.get(event.activityKey)
    if (existing) return existing
    const created: NodeCell = { ...emptyCell(), activityKey: event.activityKey, activityKind: event.activityKind }
    nodes.set(event.activityKey, created)
    return created
  }
  const edgeFor = (from: string, to: string): EdgeCell => {
    const key = JSON.stringify([from, to])
    const existing = edges.get(key)
    if (existing) return existing
    const created: EdgeCell = { ...emptyCell(), from, to }
    edges.set(key, created)
    return created
  }
  const touch = (cell: MapCell, mode: SequenceMode, caseKey: string, event: AnalyticsEvent) => {
    cell[mode] += 1
    cell.cases.add(caseKey)
    if (event.actor) cell.actors.add(event.actor)
    if (mode === 'collapsed') addCause(cell.causes, event)
  }

  for (const prepared of population) {
    const caseKey = caseKeyOf(prepared)
    const trace = prepared.trace
    if (!trace.complete) truncatedCases += 1
    const endsInWindow = (trace.status === 'completed' || trace.status === 'deleted')
      && trace.endedAtMs !== null
      && isInWindow(trace.endedAtMs, context.window)
    const sequences: Array<[SequenceMode, AnalyticsEvent[]]> = [['raw', prepared.filteredRaw], ['collapsed', prepared.filteredCollapsed]]
    for (const [mode, sequence] of sequences) {
      sequence.forEach((event, position) => {
        if (!event.inWindow) return
        totals[mode] += 1
        touch(nodeFor(event), mode, caseKey, event)
        const from = position === 0 ? (trace.complete ? XRAY_MAP_START : null) : sequence[position - 1].activityKey
        if (from === null) return
        if (from === XRAY_MAP_START && mode === 'raw') started.add(caseKey)
        touch(edgeFor(from, event.activityKey), mode, caseKey, event)
      })
      const last = sequence[sequence.length - 1]
      if (endsInWindow && last) {
        if (mode === 'raw') ended.add(caseKey)
        touch(edgeFor(last.activityKey, XRAY_MAP_END), mode, caseKey, last)
      }
    }
    totals.debounced += prepared.filteredDebounced.filter((event) => event.inWindow).length
    for (const group of prepared.filteredCorrections) {
      if (group.inWindow) totals.corrected += group.events.length
    }
  }

  const tally = createSuppressionTally()
  const visible = <TCell extends MapCell>(cells: Iterable<TCell>): TCell[] => {
    const kept: TCell[] = []
    for (const cell of cells) {
      const reason = suppressionReason({ cases: cell.cases.size, actors: cell.actors.size }, context.k)
      if (reason) tally.record(reason)
      else kept.push(cell)
    }
    return kept
  }
  const visibleNodes = visible(nodes.values()).sort((left, right) => compareCells(left, right) || left.activityKey.localeCompare(right.activityKey))
  const visibleEdges = visible(edges.values()).sort((left, right) => compareCells(left, right)
    || left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to))
  const shownNodes = visibleNodes.slice(0, XRAY_ANALYTICS_LIMITS.maxMapNodes)
  const shownEdges = visibleEdges.slice(0, XRAY_ANALYTICS_LIMITS.maxMapEdges)

  return {
    ...buildEnvelope(context.envelope, population.length, tally.summary()),
    events: totals,
    casesStarted: started.size,
    casesEnded: ended.size,
    truncatedCases,
    nodes: shownNodes.map((cell) => ({
      activityKey: cell.activityKey,
      activityKind: cell.activityKind,
      raw: cell.raw,
      collapsed: cell.collapsed,
      cases: cell.cases.size,
      causes: cell.causes,
    })),
    edges: shownEdges.map((cell) => ({
      from: cell.from,
      to: cell.to,
      raw: cell.raw,
      collapsed: cell.collapsed,
      cases: cell.cases.size,
      causes: cell.causes,
    })),
    omitted: { nodes: visibleNodes.length - shownNodes.length, edges: visibleEdges.length - shownEdges.length },
  }
}
