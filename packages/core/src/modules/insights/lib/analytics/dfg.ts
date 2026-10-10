import { buildEnvelope, type BuildContext } from './envelope'
import { createSuppressionTally, suppressCells } from './stats'
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

type NodeCell = MapCell & { activityKey: string; activityKind: string; debounced: number; corrected: number }

type EdgeCell = MapCell & { from: string; to: string; rawCases: Set<string> }

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

function edgeKey(from: string, to: string): string {
  return JSON.stringify([from, to])
}

function distinctCasesOf(cells: readonly EdgeCell[]): number {
  const cases = new Set<string>()
  for (const cell of cells) for (const caseKey of cell.rawCases) cases.add(caseKey)
  return cases.size
}

/**
 * Directly-follows graph of the window. A transition counts when its target event lies in the
 * window (its source may be earlier in the case). Every node and edge carries both the raw
 * count and the count after debounce/correction collapse (X4), and the cause kinds of its
 * collapsed target events (X6: automated steps stay in the graph, `legacy` is never human).
 * A `__start__` edge is drawn only when the (filtered) sequence starts with the first event of
 * a complete trace, an `__end__` edge only when it ends with the trace's last event and the
 * case completed or was deleted in the window. Nodes and edges are suppressed under the
 * k-anonymity / distinct-actor thresholds with complementary suppression per dimension; once
 * a cell is suppressed, the event totals (nodes) and `casesStarted` / `casesEnded` (edges) are
 * sums over the visible cells only.
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
    const created: NodeCell = { ...emptyCell(), activityKey: event.activityKey, activityKind: event.activityKind, debounced: 0, corrected: 0 }
    nodes.set(event.activityKey, created)
    return created
  }
  const edgeFor = (from: string, to: string): EdgeCell => {
    const key = edgeKey(from, to)
    const existing = edges.get(key)
    if (existing) return existing
    const created: EdgeCell = { ...emptyCell(), from, to, rawCases: new Set() }
    edges.set(key, created)
    return created
  }
  const touch = (cell: MapCell, mode: SequenceMode, caseKey: string, event: AnalyticsEvent) => {
    cell[mode] += 1
    cell.cases.add(caseKey)
    if (event.actor) cell.actors.add(event.actor)
    if (mode === 'collapsed') addCause(cell.causes, event)
  }
  const touchEdge = (cell: EdgeCell, mode: SequenceMode, caseKey: string, event: AnalyticsEvent) => {
    touch(cell, mode, caseKey, event)
    if (mode === 'raw') cell.rawCases.add(caseKey)
  }

  for (const prepared of population) {
    const caseKey = caseKeyOf(prepared)
    const trace = prepared.trace
    if (!trace.complete) truncatedCases += 1
    const endsInWindow = (trace.status === 'completed' || trace.status === 'deleted')
      && trace.endedAtMs !== null
      && isInWindow(trace.endedAtMs, context.window)
    const sequences: Array<[SequenceMode, AnalyticsEvent[], readonly AnalyticsEvent[]]> = [
      ['raw', prepared.filteredRaw, trace.events],
      ['collapsed', prepared.filteredCollapsed, prepared.collapsed],
    ]
    for (const [mode, sequence, unfiltered] of sequences) {
      const traceFirst = unfiltered[0]
      const traceLast = unfiltered[unfiltered.length - 1]
      sequence.forEach((event, position) => {
        if (!event.inWindow) return
        totals[mode] += 1
        touch(nodeFor(event), mode, caseKey, event)
        const startsTrace = position === 0 && trace.complete && traceFirst !== undefined && event.index === traceFirst.index
        const from = position === 0 ? (startsTrace ? XRAY_MAP_START : null) : sequence[position - 1].activityKey
        if (from === null) return
        if (from === XRAY_MAP_START && mode === 'raw') started.add(caseKey)
        touchEdge(edgeFor(from, event.activityKey), mode, caseKey, event)
      })
      const last = sequence[sequence.length - 1]
      if (endsInWindow && last && traceLast !== undefined && last.index === traceLast.index) {
        if (mode === 'raw') ended.add(caseKey)
        touchEdge(edgeFor(last.activityKey, XRAY_MAP_END), mode, caseKey, last)
      }
    }
    for (const event of prepared.filteredDebounced) {
      if (!event.inWindow) continue
      totals.debounced += 1
      const node = nodes.get(event.activityKey)
      if (node) node.debounced += 1
    }
    for (const group of prepared.filteredCorrections) {
      if (!group.inWindow) continue
      totals.corrected += group.events.length
      const node = nodes.get(group.activityKey)
      if (node) node.corrected += group.events.length
    }
  }

  const tally = createSuppressionTally()
  const nodeOutcome = suppressCells(Array.from(nodes.values()), (cell) => ({ key: cell.activityKey, cases: cell.cases, actors: cell.actors }), context.k, tally)
  const edgeOutcome = suppressCells(Array.from(edges.values()), (cell) => ({ key: edgeKey(cell.from, cell.to), cases: cell.cases, actors: cell.actors }), context.k, tally)
  const visibleNodes = nodeOutcome.visible.sort((left, right) => compareCells(left, right) || left.activityKey.localeCompare(right.activityKey))
  const visibleEdges = edgeOutcome.visible.sort((left, right) => compareCells(left, right)
    || left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to))
  const shownNodes = visibleNodes.slice(0, XRAY_ANALYTICS_LIMITS.maxMapNodes)
  const shownEdges = visibleEdges.slice(0, XRAY_ANALYTICS_LIMITS.maxMapEdges)
  const sumNodes = (pick: (cell: NodeCell) => number) => visibleNodes.reduce((total, cell) => total + pick(cell), 0)
  const events = nodeOutcome.anySuppressed
    ? { raw: sumNodes((cell) => cell.raw), collapsed: sumNodes((cell) => cell.collapsed), debounced: sumNodes((cell) => cell.debounced), corrected: sumNodes((cell) => cell.corrected) }
    : totals

  return {
    ...buildEnvelope(context.envelope, population.length, tally.summary()),
    events,
    casesStarted: edgeOutcome.anySuppressed ? distinctCasesOf(visibleEdges.filter((cell) => cell.from === XRAY_MAP_START)) : started.size,
    casesEnded: edgeOutcome.anySuppressed ? distinctCasesOf(visibleEdges.filter((cell) => cell.to === XRAY_MAP_END)) : ended.size,
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
