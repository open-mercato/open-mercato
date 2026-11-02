import type { NodeChange } from '@xyflow/react'
import { filterOwnedNodeChanges } from '../owned-node-changes'

/**
 * Regression guard for the canvas "teleport" bug. The trigger pill is a
 * render-only overlay node that is never in the editor's node state; ReactFlow
 * measures it and emits a `dimensions` change every render. If those changes are
 * applied via setNodes they re-render → re-mint → re-measure the overlay in an
 * unbounded loop that starves node dragging. `filterOwnedNodeChanges` drops
 * them, and the drop must leave real-node changes untouched.
 */
describe('filterOwnedNodeChanges', () => {
  const owned = new Set(['start', 'step_klient', 'end'])

  it('drops a dimensions change for a render-only overlay node', () => {
    const changes = [
      { type: 'dimensions', id: '__workflow_trigger__', dimensions: { width: 200, height: 40 } },
      { type: 'position', id: 'step_klient', position: { x: 10, y: 20 }, dragging: true },
    ] as unknown as NodeChange[]

    const result = filterOwnedNodeChanges(changes, owned)

    expect(result).toHaveLength(1)
    expect((result[0] as { id?: string }).id).toBe('step_klient')
  })

  it('returns an empty array for an overlay-only batch (the loop batch)', () => {
    const changes = [
      { type: 'dimensions', id: '__workflow_trigger__', dimensions: { width: 200, height: 40 } },
    ] as unknown as NodeChange[]

    expect(filterOwnedNodeChanges(changes, owned)).toHaveLength(0)
  })

  it('keeps every change when all ids are owned', () => {
    const changes = [
      { type: 'position', id: 'start', position: { x: 0, y: 0 }, dragging: false },
      { type: 'dimensions', id: 'step_klient', dimensions: { width: 200, height: 80 } },
      { type: 'select', id: 'end', selected: true },
    ] as unknown as NodeChange[]

    expect(filterOwnedNodeChanges(changes, owned)).toHaveLength(3)
  })

  it('keeps id-less changes (e.g. `add`) that can only come from the editor itself', () => {
    const changes = [
      { type: 'add', item: { id: 'new_step', position: { x: 0, y: 0 }, data: {} } },
      { type: 'dimensions', id: '__workflow_trigger__', dimensions: { width: 200, height: 40 } },
    ] as unknown as NodeChange[]

    const result = filterOwnedNodeChanges(changes, owned)

    expect(result).toHaveLength(1)
    expect((result[0] as { type: string }).type).toBe('add')
  })
})
