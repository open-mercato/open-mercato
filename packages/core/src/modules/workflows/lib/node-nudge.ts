/**
 * Arrow-key positioning for selected cards (spec section 4.6: "arrows nudge").
 *
 * Nudging is the keyboard's answer to dragging, so it obeys the same rule the
 * drag path does (#4248): many keystrokes are ONE arrangement. The page captures
 * the document before the first nudge of a burst and commits a single undo entry
 * plus a single autosave once the burst settles.
 *
 * PURE: nodes in, nodes out.
 */

import type { Node } from '@xyflow/react'

/** One press moves a card a hair; Shift moves it a visible step. */
export const NUDGE_STEP = 1
export const NUDGE_STEP_COARSE = 10

/** Milliseconds of no arrow key before a nudge burst counts as finished. */
export const NUDGE_COMMIT_DELAY_MS = 400

export type NudgeDirection = 'up' | 'down' | 'left' | 'right'

const NUDGE_KEYS: Record<string, NudgeDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

export function resolveNudgeDirection(key: string): NudgeDirection | null {
  return NUDGE_KEYS[key] ?? null
}

export function nudgeOffset(direction: NudgeDirection, coarse: boolean): { x: number; y: number } {
  const distance = coarse ? NUDGE_STEP_COARSE : NUDGE_STEP
  switch (direction) {
    case 'up':
      return { x: 0, y: -distance }
    case 'down':
      return { x: 0, y: distance }
    case 'left':
      return { x: -distance, y: 0 }
    default:
      return { x: distance, y: 0 }
  }
}

/**
 * Move every selected node by the offset. Returns the SAME array when nothing is
 * selected so the caller can skip the commit and the autosave entirely.
 */
export function nudgeSelectedNodes(nodes: Node[], offset: { x: number; y: number }): Node[] {
  if (!nodes.some((node) => node.selected)) return nodes
  return nodes.map((node) =>
    node.selected
      ? { ...node, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } }
      : node,
  )
}

export function selectedNodeIds(nodes: Node[]): string[] {
  return nodes.filter((node) => node.selected).map((node) => node.id)
}
