import type { Edge, Node } from '@xyflow/react'
import {
  ANNOTATION_GROUP_NODE_TYPE,
  ANNOTATION_NOTE_NODE_TYPE,
  annotationsFromNodes,
  annotationsToNodes,
  createGroupNode,
  createNoteNode,
  DEFAULT_GROUP_SIZE,
  DEFAULT_NOTE_SIZE,
  hasAnnotations,
  isAnnotationNode,
  readEditorAnnotations,
  removeAnnotationNode,
  updateAnnotationNode,
  writeEditorAnnotations,
  type WorkflowEditorAnnotations,
} from '../editor-annotations'
import { graphToDefinition, validateWorkflowGraph } from '../graph-utils'
import { serializeWorkflowSubgraph } from '../subgraph-clipboard'
import { workflowMetadataSchema } from '../../data/validators'

const stepNodes: Node[] = [
  { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
  { id: 'end', type: 'end', position: { x: 300, y: 0 }, data: { label: 'End' } },
]

const stepEdges: Edge[] = [
  { id: 't_1', source: 'start', target: 'end', data: { trigger: 'auto' } },
]

const annotations: WorkflowEditorAnnotations = {
  notes: [
    { id: 'note_1', markdown: '## Why', position: { x: 10, y: 20 }, size: { width: 240, height: 160 } },
  ],
  groups: [
    { id: 'group_1', name: 'Fulfillment', rect: { x: -20, y: -20, width: 400, height: 300 }, collapsed: true },
  ],
}

describe('editor annotations — metadata round trip', () => {
  it('reads notes and groups back out of a metadata bag', () => {
    const metadata = writeEditorAnnotations({ category: 'Sales' }, annotations)
    expect(readEditorAnnotations(metadata)).toEqual(annotations)
  })

  it('survives a JSON wire round trip and the server metadata parse', () => {
    const metadata = writeEditorAnnotations(null, annotations)
    const parsed = workflowMetadataSchema.parse(JSON.parse(JSON.stringify(metadata)))
    expect(readEditorAnnotations(parsed as Record<string, unknown>)).toEqual(annotations)
  })

  it('removes the annotations key (and an emptied editor bag) when nothing is annotated', () => {
    const withAnnotations = writeEditorAnnotations({ category: 'Sales' }, annotations)
    const cleared = writeEditorAnnotations(withAnnotations, { notes: [], groups: [] })
    expect(cleared).toEqual({ category: 'Sales' })
  })

  it('keeps sibling editor keys such as pinned samples intact', () => {
    const samples = { step_1: { pinnedAt: '2026-07-27T00:00:00.000Z', source: 'manual', data: { id: '1' } } }
    const metadata = writeEditorAnnotations({ editor: { samples } }, annotations)
    expect((metadata?.editor as Record<string, unknown>).samples).toEqual(samples)
    const cleared = writeEditorAnnotations(metadata, { notes: [], groups: [] })
    expect(cleared).toEqual({ editor: { samples } })
  })

  it('does not mutate the metadata object it is handed', () => {
    const metadata = { editor: { samples: {} } }
    const snapshot = JSON.parse(JSON.stringify(metadata))
    writeEditorAnnotations(metadata, annotations)
    expect(metadata).toEqual(snapshot)
  })

  it('tolerates malformed annotation payloads rather than throwing', () => {
    const metadata = {
      editor: { annotations: { notes: [{ markdown: 'no id' }, null, 7], groups: 'nope' } },
    }
    expect(readEditorAnnotations(metadata as unknown as Record<string, unknown>)).toEqual({ notes: [], groups: [] })
  })

  it('falls back to default sizes for annotations stored without one', () => {
    const metadata = { editor: { annotations: { notes: [{ id: 'n', markdown: 'x', position: { x: 1, y: 2 } }] } } }
    expect(readEditorAnnotations(metadata).notes[0].size).toEqual(DEFAULT_NOTE_SIZE)
  })

  it('reports an empty annotation set as absent', () => {
    expect(hasAnnotations({ notes: [], groups: [] })).toBe(false)
    expect(hasAnnotations(annotations)).toBe(true)
    expect(readEditorAnnotations(null)).toEqual({ notes: [], groups: [] })
  })
})

describe('editor annotations — node round trip', () => {
  it('round-trips annotations through the canvas node array', () => {
    expect(annotationsFromNodes(annotationsToNodes(annotations))).toEqual(annotations)
  })

  it('renders groups behind the steps they frame', () => {
    const [groupNode] = annotationsToNodes(annotations)
    expect(groupNode.type).toBe(ANNOTATION_GROUP_NODE_TYPE)
    expect(groupNode.zIndex).toBeLessThan(0)
  })

  it('ignores step nodes when deriving annotations', () => {
    expect(annotationsFromNodes(stepNodes)).toEqual({ notes: [], groups: [] })
  })

  it('creates a note and a group at the requested position with default sizes', () => {
    const note = createNoteNode({ x: 5, y: 6 }, 'hello')
    expect(note.type).toBe(ANNOTATION_NOTE_NODE_TYPE)
    expect(note.position).toEqual({ x: 5, y: 6 })
    expect(annotationsFromNodes([note]).notes[0]).toEqual({
      id: note.id,
      markdown: 'hello',
      position: { x: 5, y: 6 },
      size: DEFAULT_NOTE_SIZE,
    })

    const group = createGroupNode({ x: 1, y: 2 }, 'Ops')
    expect(annotationsFromNodes([group]).groups[0]).toEqual({
      id: group.id,
      name: 'Ops',
      rect: { x: 1, y: 2, width: DEFAULT_GROUP_SIZE.width, height: DEFAULT_GROUP_SIZE.height },
    })
  })

  it('mints distinct ids for consecutive annotations', () => {
    expect(createNoteNode({ x: 0, y: 0 }, '').id).not.toBe(createNoteNode({ x: 0, y: 0 }, '').id)
  })

  it('updates and removes only annotation nodes', () => {
    const nodes = [...stepNodes, ...annotationsToNodes(annotations)]
    const updated = updateAnnotationNode(nodes, 'note_1', { markdown: 'changed' })
    expect(annotationsFromNodes(updated).notes[0].markdown).toBe('changed')

    const untouched = updateAnnotationNode(nodes, 'start', { markdown: 'nope' })
    expect(untouched.find((node) => node.id === 'start')?.data).toEqual({ label: 'Start' })

    const removed = removeAnnotationNode(nodes, 'group_1')
    expect(annotationsFromNodes(removed).groups).toEqual([])
    expect(removeAnnotationNode(nodes, 'start')).toHaveLength(nodes.length)
  })

  it('recognises annotation nodes by type', () => {
    expect(isAnnotationNode({ type: ANNOTATION_NOTE_NODE_TYPE })).toBe(true)
    expect(isAnnotationNode({ type: ANNOTATION_GROUP_NODE_TYPE })).toBe(true)
    expect(isAnnotationNode({ type: 'automated' })).toBe(false)
  })
})

describe('annotations never reach the definition', () => {
  const annotatedNodes = [...stepNodes, ...annotationsToNodes(annotations)]

  it('produces byte-identical steps and transitions with and without annotations', () => {
    const plain = graphToDefinition(stepNodes, stepEdges, { includePositions: true })
    const annotated = graphToDefinition(annotatedNodes, stepEdges, { includePositions: true })
    expect(JSON.stringify(annotated)).toBe(JSON.stringify(plain))
  })

  it('never emits an annotation id as a step id', () => {
    const definition = graphToDefinition(annotatedNodes, stepEdges)
    expect(definition.steps.map((step) => step.stepId)).toEqual(['start', 'end'])
  })

  it('drops any edge that somehow touches an annotation', () => {
    const strayEdges: Edge[] = [...stepEdges, { id: 't_stray', source: 'start', target: 'note_1', data: {} }]
    const definition = graphToDefinition(annotatedNodes, strayEdges)
    expect(definition.transitions.map((transition) => transition.transitionId)).toEqual(['t_1'])
  })

  it('does not report annotations as disconnected steps', () => {
    const issues = validateWorkflowGraph(annotatedNodes, stepEdges)
    expect(issues.some((issue) => issue.nodeId === 'note_1' || issue.nodeId === 'group_1')).toBe(false)
    expect(validateWorkflowGraph(annotatedNodes, stepEdges)).toEqual(validateWorkflowGraph(stepNodes, stepEdges))
  })

  it('never copies an annotation onto the subgraph clipboard', () => {
    expect(serializeWorkflowSubgraph(annotatedNodes, stepEdges, ['note_1', 'group_1'])).toBeNull()
    const payload = serializeWorkflowSubgraph(annotatedNodes, stepEdges, ['start', 'end', 'note_1'])
    expect(payload?.steps.map((step) => step.stepId)).toEqual(['start', 'end'])
  })
})
