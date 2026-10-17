import dagre from '@dagrejs/dagre'
import { graphNodeSize, type XrayGraphModel, type XrayGraphNode } from './graph'

/** Top-left corner and size of a laid-out node, in graph coordinates. */
export type XrayNodeBox = { x: number; y: number; width: number; height: number }

export type XrayGraphLayout = {
  boxes: Map<string, XrayNodeBox>
  /** Extent of every box (0 × 0 for an empty graph). */
  bounds: { x: number; y: number; width: number; height: number }
}

/** Zoom at which the map's 14 px labels render at about 12 px: the initial view never goes below it. */
export const XRAY_MAP_READABLE_ZOOM = 0.86

export const XRAY_MAP_MIN_HEIGHT = 320

export const XRAY_MAP_MAX_HEIGHT = 640

export const XRAY_MAP_PADDING = 32

const RANK_SEPARATION = 64
const NODE_SEPARATION = 40

/**
 * Top-to-bottom layered layout (dagre) of the graph: the process reads downwards like a flow
 * chart, node boxes sized from their labels (`labelOf`), heavier transitions kept straighter.
 */
export function layoutProcessGraph(model: XrayGraphModel, labelOf: (node: XrayGraphNode) => string): XrayGraphLayout {
  const boxes = new Map<string, XrayNodeBox>()
  if (model.nodes.length === 0) return { boxes, bounds: { x: 0, y: 0, width: 0, height: 0 } }
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'TB', nodesep: NODE_SEPARATION, ranksep: RANK_SEPARATION })
  const sizes = new Map(model.nodes.map((node) => [node.id, graphNodeSize(node, labelOf(node))]))
  for (const node of model.nodes) graph.setNode(node.id, { ...sizes.get(node.id) })
  for (const edge of model.edges) graph.setEdge(edge.source, edge.target, { weight: Math.max(1, Math.round(edge.weight * 10)) })
  dagre.layout(graph)
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of model.nodes) {
    const placed = graph.node(node.id)
    const size = sizes.get(node.id)
    if (!placed || !size || typeof placed.x !== 'number' || typeof placed.y !== 'number') continue
    const box = { x: placed.x - size.width / 2, y: placed.y - size.height / 2, width: size.width, height: size.height }
    boxes.set(node.id, box)
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  if (boxes.size === 0) return { boxes, bounds: { x: 0, y: 0, width: 0, height: 0 } }
  return { boxes, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } }
}

/** Canvas height that shows the whole graph at full size when it is short, within bounds. */
export function processMapHeight(layout: XrayGraphLayout): number {
  const wanted = Math.ceil(layout.bounds.height + XRAY_MAP_PADDING * 2)
  return Math.min(XRAY_MAP_MAX_HEIGHT, Math.max(XRAY_MAP_MIN_HEIGHT, wanted))
}

/**
 * Initial viewport: the whole graph when it fits at a readable zoom (never above 1), else the
 * readable zoom anchored at the top (the start of the process) and centered horizontally on the
 * graph or, when wider than the canvas, on its first node. The user can still zoom out or fit.
 */
export function initialMapViewport(
  layout: XrayGraphLayout,
  canvas: { width: number; height: number },
  firstNodeId: string | null,
): { x: number; y: number; zoom: number } {
  const { bounds } = layout
  const innerWidth = Math.max(1, canvas.width - XRAY_MAP_PADDING * 2)
  const innerHeight = Math.max(1, canvas.height - XRAY_MAP_PADDING * 2)
  const fit = Math.min(innerWidth / Math.max(1, bounds.width), innerHeight / Math.max(1, bounds.height))
  const zoom = Math.min(1, Math.max(XRAY_MAP_READABLE_ZOOM, fit))
  const scaledWidth = bounds.width * zoom
  const scaledHeight = bounds.height * zoom
  const y = scaledHeight <= innerHeight
    ? (canvas.height - scaledHeight) / 2 - bounds.y * zoom
    : XRAY_MAP_PADDING - bounds.y * zoom
  if (scaledWidth <= innerWidth) return { x: (canvas.width - scaledWidth) / 2 - bounds.x * zoom, y, zoom }
  const anchor = firstNodeId ? layout.boxes.get(firstNodeId) : undefined
  const anchorCenter = anchor ? anchor.x + anchor.width / 2 : bounds.x + bounds.width / 2
  const centered = canvas.width / 2 - anchorCenter * zoom
  const leftmost = XRAY_MAP_PADDING - bounds.x * zoom
  const rightmost = canvas.width - XRAY_MAP_PADDING - (bounds.x + bounds.width) * zoom
  return { x: Math.min(leftmost, Math.max(rightmost, centered)), y, zoom }
}
