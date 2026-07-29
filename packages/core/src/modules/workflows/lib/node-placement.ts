/**
 * New-node placement (spec section 4.1/4.2, issue #4248).
 *
 * "Manual `_editorPosition` always wins until explicit Tidy" only holds if a
 * newly added step lands somewhere deliberate: the cursor when it was dropped
 * there, otherwise after the right-most step. Either way the placement is
 * nudged until it stops overlapping an existing card, so appending never hides
 * a node under another one and never drifts diagonally off-canvas.
 *
 * Pure: plain coordinates in, plain coordinates out. Shared by the palette's
 * click-append path and (step 3.8) the drag-from-palette drop path, which
 * supplies the flow-space cursor position.
 */

import { NODE_HEIGHT, NODE_MIN_WIDTH } from './node-geometry'

export interface NodeFootprint {
  position: { x: number; y: number }
  measured?: { width?: number | null; height?: number | null } | null
}

export interface NodePlacementOptions {
  /**
   * Flow-space position the node was dropped at (card centre). Absent for the
   * keyboard/click-append path, which places after the right-most node.
   */
  dropPosition?: { x: number; y: number } | null
  width?: number
  height?: number
  gap?: number
}

const DEFAULT_GAP = 48

function footprintOf(node: NodeFootprint, width: number, height: number) {
  const nodeWidth = node.measured?.width ?? width
  const nodeHeight = node.measured?.height ?? height
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + nodeWidth,
    bottom: node.position.y + nodeHeight,
  }
}

function overlaps(
  candidate: { x: number; y: number },
  nodes: NodeFootprint[],
  width: number,
  height: number,
  gap: number,
): boolean {
  const left = candidate.x - gap / 2
  const top = candidate.y - gap / 2
  const right = candidate.x + width + gap / 2
  const bottom = candidate.y + height + gap / 2
  return nodes.some((node) => {
    const box = footprintOf(node, width, height)
    return left < box.right && right > box.left && top < box.bottom && bottom > box.top
  })
}

/**
 * Resolve the position for a node about to be added to the graph.
 *
 * With a drop position the card is centred on the cursor; without one it is
 * placed one gap to the right of the right-most card, vertically aligned with
 * it. In both cases the result is pushed down in whole card heights until it no
 * longer collides with an existing card.
 */
export function resolveNewNodePlacement(
  nodes: NodeFootprint[],
  options: NodePlacementOptions = {},
): { x: number; y: number } {
  const width = options.width ?? NODE_MIN_WIDTH
  const height = options.height ?? NODE_HEIGHT
  const gap = options.gap ?? DEFAULT_GAP

  let candidate: { x: number; y: number }
  if (options.dropPosition) {
    candidate = {
      x: Math.round(options.dropPosition.x - width / 2),
      y: Math.round(options.dropPosition.y - height / 2),
    }
  } else if (nodes.length === 0) {
    candidate = { x: 0, y: 0 }
  } else {
    const rightMost = nodes.reduce((furthest, node) => {
      const edge = footprintOf(node, width, height).right
      return edge > furthest.edge ? { edge, node } : furthest
    }, { edge: Number.NEGATIVE_INFINITY, node: nodes[0] })
    candidate = {
      x: Math.round(rightMost.edge + gap),
      y: Math.round(rightMost.node.position.y),
    }
  }

  let attempts = 0
  while (overlaps(candidate, nodes, width, height, gap) && attempts < nodes.length + 1) {
    candidate = { x: candidate.x, y: candidate.y + height + gap }
    attempts += 1
  }
  return candidate
}
