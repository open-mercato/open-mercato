/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import type { Node, Edge } from '@xyflow/react'
import {
  SUBGRAPH_PASTE_OFFSET,
  WORKFLOW_SUBGRAPH_CLIPBOARD_KIND,
  WORKFLOW_SUBGRAPH_CLIPBOARD_VERSION,
  parseWorkflowSubgraph,
  pasteWorkflowSubgraph,
  serializeWorkflowSubgraph,
  stringifyWorkflowSubgraph,
} from '../subgraph-clipboard'

function node(id: string, type: string, x: number, y: number, selected = true): Node {
  return {
    id,
    type,
    position: { x, y },
    selected,
    data: { label: `${type} ${id}` },
  }
}

function edge(id: string, source: string, target: string, data: Record<string, unknown> = {}): Edge {
  return {
    id,
    source,
    target,
    type: 'workflowTransition',
    data: { trigger: 'auto', ...data },
  }
}

const nodes: Node[] = [
  node('start_1', 'start', 0, 0, false),
  node('task_1', 'userTask', 200, 0),
  node('task_2', 'automated', 400, 0),
  node('end_1', 'end', 600, 0, false),
]

const edges: Edge[] = [
  edge('t_in', 'start_1', 'task_1'),
  edge('t_internal', 'task_1', 'task_2', { transitionName: 'approved', priority: 30, condition: 'amount > 10' }),
  edge('t_out', 'task_2', 'end_1'),
]

describe('workflow subgraph clipboard (spec section 4.5)', () => {
  test('serializes the selection as portable definition JSON', () => {
    const payload = serializeWorkflowSubgraph(nodes, edges, ['task_1', 'task_2'])!
    expect(payload.kind).toBe(WORKFLOW_SUBGRAPH_CLIPBOARD_KIND)
    expect(payload.version).toBe(WORKFLOW_SUBGRAPH_CLIPBOARD_VERSION)
    expect(payload.steps.map((step) => step.stepId)).toEqual(['task_1', 'task_2'])
    expect(payload.steps.map((step) => step.stepType)).toEqual(['USER_TASK', 'AUTOMATED'])
    expect((payload.steps[0] as { _editorPosition?: { x: number; y: number } })._editorPosition).toEqual({ x: 200, y: 0 })
  })

  test('keeps transitions internal to the selection and drops the ones crossing its boundary', () => {
    const payload = serializeWorkflowSubgraph(nodes, edges, ['task_1', 'task_2'])!
    expect(payload.transitions).toHaveLength(1)
    expect(payload.transitions[0]).toMatchObject({
      transitionId: 't_internal',
      fromStepId: 'task_1',
      toStepId: 'task_2',
      transitionName: 'approved',
      priority: 30,
      condition: 'amount > 10',
    })
  })

  test('an empty selection produces no payload', () => {
    expect(serializeWorkflowSubgraph(nodes, edges, [])).toBeNull()
  })

  test('round-trips through the clipboard text', () => {
    const payload = serializeWorkflowSubgraph(nodes, edges, ['task_1', 'task_2'])!
    const parsed = parseWorkflowSubgraph(stringifyWorkflowSubgraph(payload))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.payload).toEqual(payload)
  })

  test('refuses clipboard content that is not a workflow selection', () => {
    expect(parseWorkflowSubgraph('not json')).toEqual({ ok: false, code: 'invalidJson' })
    expect(parseWorkflowSubgraph('{"kind":"something-else"}')).toEqual({ ok: false, code: 'unsupportedFormat' })
    expect(
      parseWorkflowSubgraph(JSON.stringify({ kind: WORKFLOW_SUBGRAPH_CLIPBOARD_KIND, version: 99, steps: [], transitions: [] })),
    ).toEqual({ ok: false, code: 'unsupportedFormat' })
    expect(
      parseWorkflowSubgraph(JSON.stringify({ kind: WORKFLOW_SUBGRAPH_CLIPBOARD_KIND, version: 1, steps: [], transitions: [] })),
    ).toEqual({ ok: false, code: 'empty' })
  })

  test('paste re-IDs every step and transition, so nothing collides with the original', () => {
    const payload = serializeWorkflowSubgraph(nodes, edges, ['task_1', 'task_2'])!
    const result = pasteWorkflowSubgraph(nodes, edges, payload)

    expect(result.pastedNodeIds).toHaveLength(2)
    for (const pastedId of result.pastedNodeIds) {
      expect(nodes.some((existing) => existing.id === pastedId)).toBe(false)
    }
    expect(new Set(result.nodes.map((candidate) => candidate.id)).size).toBe(result.nodes.length)
    expect(new Set(result.edges.map((candidate) => candidate.id)).size).toBe(result.edges.length)
    expect(result.pastedNodeIds[0]).toMatch(/^task_1_/)
    expect(result.pastedNodeIds[1]).toMatch(/^task_2_/)
  })

  test('re-IDing a generated id reuses its prefix instead of stacking suffixes', () => {
    const generated = node('userTask_1753200000000_abc123xyz', 'userTask', 0, 0)
    const payload = serializeWorkflowSubgraph([generated], [], [generated.id])!
    const first = pasteWorkflowSubgraph([generated], [], payload)
    const second = pasteWorkflowSubgraph(
      first.nodes,
      first.edges,
      serializeWorkflowSubgraph(first.nodes, first.edges, [first.pastedNodeIds[0]])!,
    )
    expect(first.pastedNodeIds[0]).toMatch(/^usertask_\d+_[a-z0-9]+$/)
    expect(second.pastedNodeIds[0]).toMatch(/^usertask_\d+_[a-z0-9]+$/)
  })

  test('paste rewires the internal route onto the new ids and keeps its configuration', () => {
    const payload = serializeWorkflowSubgraph(nodes, edges, ['task_1', 'task_2'])!
    const result = pasteWorkflowSubgraph(nodes, edges, payload)

    const pastedEdges = result.edges.filter((candidate) => !edges.some((existing) => existing.id === candidate.id))
    expect(pastedEdges).toHaveLength(1)
    expect(pastedEdges[0].source).toBe(result.pastedNodeIds[0])
    expect(pastedEdges[0].target).toBe(result.pastedNodeIds[1])
    expect(pastedEdges[0].id).not.toBe('t_internal')
    expect(pastedEdges[0].data).toMatchObject({ transitionName: 'approved', priority: 30, condition: 'amount > 10' })
  })

  test('paste offsets the copies and never touches the existing graph', () => {
    const payload = serializeWorkflowSubgraph(nodes, edges, ['task_1', 'task_2'])!
    const result = pasteWorkflowSubgraph(nodes, edges, payload)

    const pastedFirst = result.nodes.find((candidate) => candidate.id === result.pastedNodeIds[0])!
    expect(pastedFirst.position).toEqual({ x: 200 + SUBGRAPH_PASTE_OFFSET.x, y: 0 + SUBGRAPH_PASTE_OFFSET.y })
    expect(pastedFirst.selected).toBe(true)

    const originals = result.nodes.filter((candidate) => nodes.some((existing) => existing.id === candidate.id))
    expect(originals.map((candidate) => candidate.position)).toEqual(nodes.map((candidate) => candidate.position))
    expect(originals.every((candidate) => !candidate.selected)).toBe(true)
  })

  test('honours an explicit offset so duplicate-in-place is a paste with its own nudge', () => {
    const payload = serializeWorkflowSubgraph(nodes, edges, ['task_1'])!
    const result = pasteWorkflowSubgraph(nodes, edges, payload, { offset: { x: 10, y: -20 } })
    const pasted = result.nodes.find((candidate) => candidate.id === result.pastedNodeIds[0])!
    expect(pasted.position).toEqual({ x: 210, y: -20 })
  })

  test('a payload whose transitions reference steps it does not carry drops them', () => {
    const payload = serializeWorkflowSubgraph(nodes, edges, ['task_1', 'task_2'])!
    const tampered = {
      ...payload,
      transitions: [...payload.transitions, { transitionId: 't_dangling', fromStepId: 'task_1', toStepId: 'ghost', trigger: 'auto' }],
    } as typeof payload
    const result = pasteWorkflowSubgraph(nodes, edges, tampered)
    const pastedEdges = result.edges.filter((candidate) => !edges.some((existing) => existing.id === candidate.id))
    expect(pastedEdges).toHaveLength(1)
  })
})
