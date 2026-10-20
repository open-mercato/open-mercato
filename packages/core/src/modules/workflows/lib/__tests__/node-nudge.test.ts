import type { Node } from '@xyflow/react'
import {
  NUDGE_STEP,
  NUDGE_STEP_COARSE,
  nudgeOffset,
  nudgeSelectedNodes,
  resolveNudgeDirection,
  selectedNodeIds,
} from '../node-nudge'

const nodes: Node[] = [
  { id: 'a', type: 'automated', position: { x: 100, y: 100 }, data: {}, selected: true },
  { id: 'b', type: 'automated', position: { x: 300, y: 100 }, data: {} },
  { id: 'c', type: 'userTask', position: { x: 500, y: 100 }, data: {}, selected: true },
]

describe('resolveNudgeDirection', () => {
  it('maps the four arrow keys and nothing else', () => {
    expect(resolveNudgeDirection('ArrowUp')).toBe('up')
    expect(resolveNudgeDirection('ArrowDown')).toBe('down')
    expect(resolveNudgeDirection('ArrowLeft')).toBe('left')
    expect(resolveNudgeDirection('ArrowRight')).toBe('right')
    expect(resolveNudgeDirection('Enter')).toBeNull()
    expect(resolveNudgeDirection('a')).toBeNull()
  })
})

describe('nudgeOffset', () => {
  it('moves one unit per press and a coarse step with Shift', () => {
    expect(nudgeOffset('up', false)).toEqual({ x: 0, y: -NUDGE_STEP })
    expect(nudgeOffset('down', false)).toEqual({ x: 0, y: NUDGE_STEP })
    expect(nudgeOffset('left', true)).toEqual({ x: -NUDGE_STEP_COARSE, y: 0 })
    expect(nudgeOffset('right', true)).toEqual({ x: NUDGE_STEP_COARSE, y: 0 })
  })
})

describe('nudgeSelectedNodes', () => {
  it('moves every selected node and leaves the rest untouched', () => {
    const moved = nudgeSelectedNodes(nodes, { x: 10, y: -10 })
    expect(moved.map((node) => node.position)).toEqual([
      { x: 110, y: 90 },
      { x: 300, y: 100 },
      { x: 510, y: 90 },
    ])
    expect(moved[1]).toBe(nodes[1])
  })

  it('returns the same array when nothing is selected, so the caller can skip the save', () => {
    const unselected = nodes.map((node) => ({ ...node, selected: false }))
    expect(nudgeSelectedNodes(unselected, { x: 5, y: 5 })).toBe(unselected)
  })

  it('does not mutate the nodes it is handed', () => {
    const snapshot = JSON.parse(JSON.stringify(nodes))
    nudgeSelectedNodes(nodes, { x: 25, y: 25 })
    expect(JSON.parse(JSON.stringify(nodes))).toEqual(snapshot)
  })

  it('accumulates across a burst of presses', () => {
    let current = nodes
    for (let press = 0; press < 5; press += 1) {
      current = nudgeSelectedNodes(current, nudgeOffset('right', false))
    }
    expect(current[0].position).toEqual({ x: 100 + 5 * NUDGE_STEP, y: 100 })
  })
})

describe('selectedNodeIds', () => {
  it('lists the selected ids in canvas order', () => {
    expect(selectedNodeIds(nodes)).toEqual(['a', 'c'])
    expect(selectedNodeIds(nodes.map((node) => ({ ...node, selected: false })))).toEqual([])
  })
})
