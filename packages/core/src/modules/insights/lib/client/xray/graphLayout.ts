import dagre from '@dagrejs/dagre'
import { graphNodeSize, type XrayGraphModel } from './graph'

/** Left-to-right layered positions (top-left corners) of the graph's nodes. */
export function layoutProcessGraph(model: XrayGraphModel): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (model.nodes.length === 0) return positions
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 })
  for (const node of model.nodes) graph.setNode(node.id, graphNodeSize(node))
  for (const edge of model.edges) graph.setEdge(edge.source, edge.target, { weight: Math.max(1, Math.round(edge.weight * 10)) })
  dagre.layout(graph)
  for (const node of model.nodes) {
    const placed = graph.node(node.id)
    if (!placed || typeof placed.x !== 'number' || typeof placed.y !== 'number') continue
    const size = graphNodeSize(node)
    positions.set(node.id, { x: placed.x - size.width / 2, y: placed.y - size.height / 2 })
  }
  return positions
}
