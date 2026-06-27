/**
 * Phase 5 — persisted node positions + Auto-arrange.
 *
 * `definitionToGraph` must honor author-arranged `_editorPosition` coordinates on
 * load (auto-arranging only steps that lack one), and `applyAutoLayout` must
 * re-tidy the graph left→right while ignoring stored positions.
 */

import { describe, test, expect } from '@jest/globals'
import type { Node, Edge } from '@xyflow/react'
import { definitionToGraph, applyAutoLayout } from '../graph-utils'

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
})
