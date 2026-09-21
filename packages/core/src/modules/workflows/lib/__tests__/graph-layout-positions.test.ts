/**
 * Phase 5 — persisted node positions + Auto-arrange.
 *
 * `definitionToGraph` must honor author-arranged `_editorPosition` coordinates on
 * load (auto-arranging only steps that lack one), and `applyAutoLayout` must
 * re-tidy the graph left→right while ignoring stored positions.
 */

import { describe, test, expect } from '@jest/globals'
import type { Node, Edge } from '@xyflow/react'
import { definitionToGraph, applyAutoLayout, graphToDefinition, liftReturnNodesBelow, RETURN_LANE_GAP } from '../graph-utils'

const baseDefinition = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'task', stepName: 'Task', stepType: 'AUTOMATED' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 'start-task', fromStepId: 'start', toStepId: 'task', trigger: 'auto' },
    { transitionId: 'task-end', fromStepId: 'task', toStepId: 'end', trigger: 'auto' },
  ],
} as any

describe('definitionToGraph — stored positions', () => {
  test('returns the exact stored positions when every step carries one', () => {
    const definition = {
      ...baseDefinition,
      steps: [
        { ...baseDefinition.steps[0], _editorPosition: { x: 10, y: 20 } },
        { ...baseDefinition.steps[1], _editorPosition: { x: 300, y: 25 } },
        { ...baseDefinition.steps[2], _editorPosition: { x: 600, y: 30 } },
      ],
    }

    const { nodes } = definitionToGraph(definition)

    expect(nodes.find((node) => node.id === 'start')?.position).toEqual({ x: 10, y: 20 })
    expect(nodes.find((node) => node.id === 'task')?.position).toEqual({ x: 300, y: 25 })
    expect(nodes.find((node) => node.id === 'end')?.position).toEqual({ x: 600, y: 30 })
  })

  test('keeps stored positions and dagre-places only the step without one', () => {
    const definition = {
      ...baseDefinition,
      steps: [
        { ...baseDefinition.steps[0], _editorPosition: { x: 10, y: 20 } },
        { ...baseDefinition.steps[1] }, // no stored position → auto-arranged
        { ...baseDefinition.steps[2], _editorPosition: { x: 600, y: 30 } },
      ],
    }

    const { nodes } = definitionToGraph(definition)

    // Stored ones stay exactly put.
    expect(nodes.find((node) => node.id === 'start')?.position).toEqual({ x: 10, y: 20 })
    expect(nodes.find((node) => node.id === 'end')?.position).toEqual({ x: 600, y: 30 })

    // The position-less node gets a computed (dagre) placement, not the stored ones.
    const taskPos = nodes.find((node) => node.id === 'task')?.position
    expect(taskPos).toBeDefined()
    expect(taskPos).not.toEqual({ x: 10, y: 20 })
    expect(taskPos).not.toEqual({ x: 600, y: 30 })
  })

  test('runs full dagre LR layout when no step carries a stored position', () => {
    const { nodes } = definitionToGraph(baseDefinition)

    const startX = nodes.find((node) => node.id === 'start')!.position.x
    const taskX = nodes.find((node) => node.id === 'task')!.position.x
    const endX = nodes.find((node) => node.id === 'end')!.position.x

    // Left→right: each downstream step sits further right than its predecessor.
    expect(taskX).toBeGreaterThan(startX)
    expect(endX).toBeGreaterThan(taskX)
  })
})

describe('manual arrangement round trip (#4248)', () => {
  const draggedNodes: Node[] = [
    { id: 'start', type: 'start', position: { x: 12, y: 340 }, data: { label: 'Start' } },
    { id: 'task', type: 'automated', position: { x: 480, y: 96 }, data: { label: 'Task' } },
    { id: 'end', type: 'end', position: { x: 940, y: 512 }, data: { label: 'End' } },
  ]
  const draggedEdges: Edge[] = [
    { id: 't_1', source: 'start', target: 'task', type: 'workflowTransition', data: { trigger: 'auto' } },
    { id: 't_2', source: 'task', target: 'end', type: 'workflowTransition', data: { trigger: 'auto' } },
  ]

  test('dragged positions survive a save/draft round trip unchanged', () => {
    const saved = graphToDefinition(draggedNodes, draggedEdges, { includePositions: true })
    const reopened = definitionToGraph(saved as never)

    for (const node of draggedNodes) {
      expect(reopened.nodes.find((candidate) => candidate.id === node.id)?.position).toEqual(node.position)
    }
  })

  test('a payload built without positions re-arranges instead of inventing stale ones', () => {
    const saved = graphToDefinition(draggedNodes, draggedEdges)
    expect(saved.steps.every((step) => (step as { _editorPosition?: unknown })._editorPosition === undefined)).toBe(true)

    const reopened = definitionToGraph(saved as never)
    const startX = reopened.nodes.find((node) => node.id === 'start')!.position.x
    const endX = reopened.nodes.find((node) => node.id === 'end')!.position.x
    expect(endX).toBeGreaterThan(startX)
  })

  test('Tidy is the only thing that overrides a manual arrangement', () => {
    const tidied = applyAutoLayout(draggedNodes, draggedEdges)
    expect(tidied.find((node) => node.id === 'end')!.position).not.toEqual({ x: 940, y: 512 })

    const saved = graphToDefinition(tidied, draggedEdges, { includePositions: true })
    const reopened = definitionToGraph(saved as never)
    for (const node of tidied) {
      expect(reopened.nodes.find((candidate) => candidate.id === node.id)?.position).toEqual(node.position)
    }
  })
})

describe('applyAutoLayout', () => {
  test('repositions nodes left→right ignoring stored positions and preserves node data', () => {
    const nodes: Node[] = [
      { id: 'start', type: 'start', position: { x: 999, y: 5 }, data: { label: 'Start', badge: 'Start' } },
      { id: 'task', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'Task', badge: 'Automated' } },
      { id: 'end', type: 'end', position: { x: 4, y: 4 }, data: { label: 'End', badge: 'End' } },
    ]
    const edges: Edge[] = [
      { id: 'start-task', source: 'start', target: 'task', type: 'workflowTransition' },
      { id: 'task-end', source: 'task', target: 'end', type: 'workflowTransition' },
    ]

    const result = applyAutoLayout(nodes, edges)

    const startX = result.find((node) => node.id === 'start')!.position.x
    const taskX = result.find((node) => node.id === 'task')!.position.x
    const endX = result.find((node) => node.id === 'end')!.position.x

    expect(taskX).toBeGreaterThan(startX)
    expect(endX).toBeGreaterThan(taskX)

    // Original arbitrary positions are overwritten (ignored), data is preserved.
    expect(startX).not.toBe(999)
    const taskNode = result.find((node) => node.id === 'task')!
    expect(taskNode.type).toBe('automated')
    expect((taskNode.data as any).label).toBe('Task')
    expect((taskNode.data as any).badge).toBe('Automated')
  })

  test('transition labels are hover-only and do not widen the gap to the next node', () => {
    const nodes: Node[] = [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
      { id: 'task', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'Task' } },
    ]
    const unlabeled: Edge[] = [
      { id: 'start-task', source: 'start', target: 'task', type: 'workflowTransition', data: {} },
    ]
    const labeled: Edge[] = [
      {
        id: 'start-task',
        source: 'start',
        target: 'task',
        type: 'workflowTransition',
        data: { label: 'Skip Effector On Reject' },
      },
    ]

    const gapFor = (edges: Edge[]) => {
      const out = applyAutoLayout(nodes, edges)
      const a = out.find((node) => node.id === 'start')!.position.x
      const b = out.find((node) => node.id === 'task')!.position.x
      return b - a
    }

    // Labels render on hover only (WorkflowTransitionEdge), so they occupy no
    // persistent canvas space — a labelled edge must NOT push the downstream node
    // any further right than a bare edge.
    expect(gapFor(labeled)).toBe(gapFor(unlabeled))
  })

  test('reserves each node measured footprint so wide cards do not overlap', () => {
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b', type: 'workflowTransition' },
    ]
    const wideNodes: Node[] = [
      { id: 'a', type: 'start', position: { x: 0, y: 0 }, data: { label: 'A' }, measured: { width: 280, height: 90 } },
      { id: 'b', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'B' }, measured: { width: 280, height: 90 } },
    ]
    const narrowNodes: Node[] = [
      { id: 'a', type: 'start', position: { x: 0, y: 0 }, data: { label: 'A' }, measured: { width: 120, height: 60 } },
      { id: 'b', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'B' }, measured: { width: 120, height: 60 } },
    ]

    const leftEdgeGap = (out: Node[]) => {
      const a = out.find((node) => node.id === 'a')!
      const b = out.find((node) => node.id === 'b')!
      // x is the card's left edge; the visible gap is b.left − a.right.
      const aWidth = a.measured!.width!
      return b.position.x - (a.position.x + aWidth)
    }

    // dagre reserves the measured width, so the visible inter-card gap is the
    // same `ranksep` regardless of how wide the cards are — wide cards keep their
    // gap instead of overlapping the neighbour.
    const wideGap = leftEdgeGap(applyAutoLayout(wideNodes, edges))
    const narrowGap = leftEdgeGap(applyAutoLayout(narrowNodes, edges))
    expect(wideGap).toBeGreaterThan(0)
    expect(Math.abs(wideGap - narrowGap)).toBeLessThanOrEqual(1)
  })

  test('described nodes reserve more width than bare-title nodes when unmeasured', () => {
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b', type: 'workflowTransition' },
    ]
    // Both upstream nodes are steps: a terminal is a fixed-size pill and
    // deliberately ignores its description (see the next case).
    const described: Node[] = [
      { id: 'a', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'A', description: 'Some explanatory copy' } },
      { id: 'b', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'B', description: 'Some explanatory copy' } },
    ]
    const bare: Node[] = [
      { id: 'a', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'A' } },
      { id: 'b', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'B' } },
    ]

    const downstreamX = (input: Node[]) =>
      applyAutoLayout(input, edges).find((node) => node.id === 'b')!.position.x

    // With no measured size, a described card is estimated at the max width, so
    // its downstream neighbour is pushed further right than the bare-title case.
    expect(downstreamX(described)).toBeGreaterThan(downstreamX(bare))
  })

  test('a terminal reserves a compact pill footprint, not a step-sized card', () => {
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b', type: 'workflowTransition' },
    ]
    const withTerminal: Node[] = [
      { id: 'a', type: 'start', position: { x: 0, y: 0 }, data: { label: 'A', description: 'Some explanatory copy' } },
      { id: 'b', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'B' } },
    ]
    const withStep: Node[] = [
      { id: 'a', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'A', description: 'Some explanatory copy' } },
      { id: 'b', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'B' } },
    ]

    const downstreamX = (input: Node[]) =>
      applyAutoLayout(input, edges).find((node) => node.id === 'b')!.position.x

    // START/END render as auto-width pills, so they take less horizontal room
    // than the described step card they used to be indistinguishable from.
    expect(downstreamX(withTerminal)).toBeLessThan(downstreamX(withStep))
  })
})

describe('liftReturnNodesBelow — loop nodes drop into a return lane', () => {
  const size = (ids: string[]) =>
    new Map(ids.map((id) => [id, { width: 200, height: 100 }]))

  test('a dedicated return node is lowered below the cards its arc spans, keeping x', () => {
    const positions = new Map([
      ['assess', { x: 0, y: 0 }],
      ['ocena', { x: 264, y: 0 }],
      ['timer', { x: 528, y: 0 }], // dagre ranked it inline, to the right
    ])
    const transitions = [
      { fromStepId: 'assess', toStepId: 'ocena' },
      { fromStepId: 'assess', toStepId: 'timer' }, // error -> retry timer
      { fromStepId: 'timer', toStepId: 'assess' }, // back-edge (return)
    ]
    const result = liftReturnNodesBelow(positions, size(['assess', 'ocena', 'timer']), transitions)

    // timer keeps its x but drops into the lane below the 100px-tall row.
    expect(result.get('timer')!.x).toBe(528)
    expect(result.get('timer')!.y).toBe(100 + RETURN_LANE_GAP)
    // the main-flow nodes are untouched.
    expect(result.get('assess')).toEqual({ x: 0, y: 0 })
    expect(result.get('ocena')).toEqual({ x: 264, y: 0 })
  })

  test('a multi-branch step on a real business loop is left to dagre (not lowered)', () => {
    const positions = new Map([
      ['review', { x: 400, y: 0 }],
      ['start', { x: 0, y: 0 }],
      ['done', { x: 800, y: 0 }],
    ])
    const transitions = [
      { fromStepId: 'start', toStepId: 'review' },
      { fromStepId: 'review', toStepId: 'start' }, // back-edge, but review also branches forward
      { fromStepId: 'review', toStepId: 'done' },
    ]
    const result = liftReturnNodesBelow(positions, size(['review', 'start', 'done']), transitions)
    // review has out-degree 2 → not a dedicated return node → unchanged.
    expect(result.get('review')).toEqual({ x: 400, y: 0 })
  })

  test('applyAutoLayout puts a retry timer below the main row', () => {
    const nodes: Node[] = [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
      { id: 'assess', type: 'invokeAgent', position: { x: 0, y: 0 }, data: { label: 'Assess' } },
      { id: 'timer', type: 'waitForTimer', position: { x: 0, y: 0 }, data: { label: 'Retry wait' } },
      { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: { label: 'End' } },
    ]
    const edges: Edge[] = [
      { id: 'e1', source: 'start', target: 'assess', type: 'workflowTransition' },
      { id: 'e2', source: 'assess', target: 'end', type: 'workflowTransition' },
      { id: 'e3', source: 'assess', target: 'timer', type: 'workflowTransition' }, // error -> timer
      { id: 'e4', source: 'timer', target: 'assess', type: 'workflowTransition' }, // retry back
    ]
    const result = applyAutoLayout(nodes, edges)
    const assessY = result.find((node) => node.id === 'assess')!.position.y
    const timerY = result.find((node) => node.id === 'timer')!.position.y
    expect(timerY).toBeGreaterThan(assessY)
  })
})
