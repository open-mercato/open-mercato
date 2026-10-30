import type { NodeChange } from '@xyflow/react'

/**
 * PURE. Keep only the ReactFlow node changes that target a node the editor
 * actually owns (i.e. a node in its controlled `nodes` state).
 *
 * WorkflowGraphImpl mints render-only overlay nodes — the trigger pill (fidelity
 * gap #5) — inside `canvasNodes` at render time; they are handed to ReactFlow
 * but never stored in node state. ReactFlow still measures such a node and emits
 * a `dimensions` change on every render. Applying that change via `setNodes`
 * schedules a re-render, which re-mints the overlay as a fresh object, which
 * ReactFlow re-measures — an unbounded loop that pins the CPU and starves node
 * dragging, so a dragged card never visibly tracks the cursor and only lands at
 * the drop point (the "teleport" bug). Dropping the overlay's changes here keeps
 * that batch from scheduling a re-render at all.
 *
 * Changes without an `id` (e.g. `add`, which carries `item` instead) are always
 * kept: they can only originate from the editor's own code, never from overlay
 * measurement.
 */
export function filterOwnedNodeChanges(
  changes: NodeChange[],
  ownedIds: ReadonlySet<string>,
): NodeChange[] {
  return changes.filter((change) => {
    const id = (change as { id?: string }).id
    return id === undefined || ownedIds.has(id)
  })
}
