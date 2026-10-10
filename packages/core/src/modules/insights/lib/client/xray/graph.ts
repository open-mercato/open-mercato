import { XRAY_MAP_END_KEY, XRAY_MAP_START_KEY } from './format'
import type { XrayCauseCounts, XrayMapResponse } from './types'

export const XRAY_GRAPH_MODES = ['collapsed', 'raw'] as const

export type XrayGraphMode = (typeof XRAY_GRAPH_MODES)[number]

export type XrayCauseClass = 'human' | 'automated' | 'legacy' | 'mixed' | 'none'

export type XrayGraphNodeKind = 'activity' | 'start' | 'end' | 'hidden'

export type XrayGraphNode = {
  id: string
  activityKey: string
  kind: XrayGraphNodeKind
  activityKind: string | null
  count: number | null
  cases: number | null
  causeClass: XrayCauseClass
  selfLoops: number
}

export type XrayGraphEdge = {
  id: string
  from: string
  to: string
  source: string
  target: string
  count: number
  cases: number
  causeClass: XrayCauseClass
  touchesHidden: boolean
  weight: number
}

export type XrayGraphModel = {
  nodes: XrayGraphNode[]
  edges: XrayGraphEdge[]
  hiddenNodes: number
}

export const XRAY_GRAPH_NODE_WIDTH = 220
export const XRAY_GRAPH_NODE_HEIGHT = 72
export const XRAY_GRAPH_TERMINAL_WIDTH = 120
export const XRAY_GRAPH_TERMINAL_HEIGHT = 40

const DOMINANT_SHARE = 0.6

export function graphNodeId(activityKey: string): string {
  return `node:${activityKey}`
}

function graphEdgeId(from: string, to: string): string {
  return `edge:${JSON.stringify([from, to])}`
}

/**
 * The cause class that dominates a cell: a class holding at least 60 % of the counted events,
 * else `mixed`; `none` without events. `legacy` (rows recorded before causation tracking) is a
 * class of its own and never counted as human.
 */
export function dominantCause(causes: XrayCauseCounts): XrayCauseClass {
  const total = causes.human + causes.automated + causes.legacy + causes.other
  if (total <= 0) return 'none'
  if (causes.human / total >= DOMINANT_SHARE) return 'human'
  if (causes.automated / total >= DOMINANT_SHARE) return 'automated'
  if (causes.legacy / total >= DOMINANT_SHARE) return 'legacy'
  return 'mixed'
}

function terminalKind(activityKey: string): XrayGraphNodeKind | null {
  if (activityKey === XRAY_MAP_START_KEY) return 'start'
  if (activityKey === XRAY_MAP_END_KEY) return 'end'
  return null
}

/**
 * The directly-follows graph of one map result in the raw or collapsed (debounce and
 * corrections removed) counting. Cells with a zero count in that mode are left out. An edge
 * whose endpoint is an activity without a visible node (its cell was suppressed for privacy)
 * keeps a `hidden` placeholder node without counts, so the suppression is shown instead of
 * silently dropping the transition. Repeats of one activity (A → A) become the node's
 * `selfLoops` count instead of an edge.
 */
export function buildProcessGraph(map: Pick<XrayMapResponse, 'nodes' | 'edges'>, mode: XrayGraphMode): XrayGraphModel {
  const nodes = new Map<string, XrayGraphNode>()
  for (const node of map.nodes) {
    const count = mode === 'raw' ? node.raw : node.collapsed
    if (count <= 0) continue
    nodes.set(node.activityKey, {
      id: graphNodeId(node.activityKey),
      activityKey: node.activityKey,
      kind: terminalKind(node.activityKey) ?? 'activity',
      activityKind: node.activityKind,
      count,
      cases: node.cases,
      causeClass: dominantCause(node.causes),
      selfLoops: 0,
    })
  }
  const ensureEndpoint = (activityKey: string): XrayGraphNode => {
    const existing = nodes.get(activityKey)
    if (existing) return existing
    const terminal = terminalKind(activityKey)
    const created: XrayGraphNode = {
      id: graphNodeId(activityKey),
      activityKey,
      kind: terminal ?? 'hidden',
      activityKind: null,
      count: null,
      cases: null,
      causeClass: 'none',
      selfLoops: 0,
    }
    nodes.set(activityKey, created)
    return created
  }
  const visibleEdges = map.edges
    .map((edge) => ({ edge, count: mode === 'raw' ? edge.raw : edge.collapsed }))
    .filter((entry) => entry.count > 0)
  const maxCount = visibleEdges.reduce((max, entry) => (entry.edge.from === entry.edge.to ? max : Math.max(max, entry.count)), 0)
  const edges: XrayGraphEdge[] = []
  for (const { edge, count } of visibleEdges) {
    if (edge.from === edge.to) {
      ensureEndpoint(edge.from).selfLoops += count
      continue
    }
    const source = ensureEndpoint(edge.from)
    const target = ensureEndpoint(edge.to)
    edges.push({
      id: graphEdgeId(edge.from, edge.to),
      from: edge.from,
      to: edge.to,
      source: source.id,
      target: target.id,
      count,
      cases: edge.cases,
      causeClass: dominantCause(edge.causes),
      touchesHidden: source.kind === 'hidden' || target.kind === 'hidden',
      weight: maxCount > 0 ? count / maxCount : 0,
    })
  }
  const ordered = Array.from(nodes.values())
  return { nodes: ordered, edges, hiddenNodes: ordered.filter((node) => node.kind === 'hidden').length }
}

export function graphNodeSize(node: Pick<XrayGraphNode, 'kind'>): { width: number; height: number } {
  return node.kind === 'start' || node.kind === 'end'
    ? { width: XRAY_GRAPH_TERMINAL_WIDTH, height: XRAY_GRAPH_TERMINAL_HEIGHT }
    : { width: XRAY_GRAPH_NODE_WIDTH, height: XRAY_GRAPH_NODE_HEIGHT }
}
