import type { Node, Edge } from '@xyflow/react'
import { collectValidationIssues, countIssuesBySeverity } from '../collect-validation-issues'
import type { ValidationError } from '../graph-utils'

const nodes: Node[] = [
  { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
  { id: 'step1', type: 'userTask', position: { x: 0, y: 100 }, data: { label: 'Review Request' } },
  { id: 'end', type: 'end', position: { x: 0, y: 200 }, data: { label: '' } },
]

const edges: Edge[] = [
  { id: 'e-start-step1', source: 'start', target: 'step1', data: {} },
  { id: 'e-step1-end', source: 'step1', target: 'end', data: {} },
]

describe('collectValidationIssues', () => {
  it('maps graph errors keeping nodeId/edgeId and resolving node labels', () => {
    const graphErrors: ValidationError[] = [
      { type: 'error', message: 'Node "Review Request" is disconnected', nodeId: 'step1' },
      { type: 'warning', message: 'Workflow contains cycles (loops)' },
    ]

    const issues = collectValidationIssues({ graphErrors, nodes, edges })

    expect(issues).toHaveLength(2)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      message: 'Node "Review Request" is disconnected',
      nodeId: 'step1',
      nodeLabel: 'Review Request',
    })
    expect(issues[1]).toMatchObject({ severity: 'warning', message: 'Workflow contains cycles (loops)' })
    expect(issues[1].nodeId).toBeUndefined()
  })

  it('maps zod step paths back to the node at that index', () => {
    const issues = collectValidationIssues({
      graphErrors: [],
      zodIssues: [{ path: ['steps', 1, 'activities', 0, 'config'], message: 'Required' }],
      nodes,
      edges,
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      message: 'steps.1.activities.0.config - Required',
      nodeId: 'step1',
      nodeLabel: 'Review Request',
    })
  })

  it('maps zod transition paths back to the edge at that index', () => {
    const issues = collectValidationIssues({
      graphErrors: [],
      zodIssues: [{ path: ['transitions', 0, 'trigger'], message: 'Invalid trigger' }],
      nodes,
      edges,
    })

    expect(issues[0]).toMatchObject({
      message: 'transitions.0.trigger - Invalid trigger',
      edgeId: 'e-start-step1',
    })
    expect(issues[0].nodeId).toBeUndefined()
  })

  it('falls back to the node id when the label is empty', () => {
    const issues = collectValidationIssues({
      graphErrors: [{ type: 'warning', message: 'No outgoing connections', nodeId: 'end' }],
      nodes,
      edges,
    })

    expect(issues[0].nodeLabel).toBe('end')
  })

  it('leaves unmappable zod paths without node or edge references', () => {
    const issues = collectValidationIssues({
      graphErrors: [],
      zodIssues: [
        { path: ['steps'], message: 'At least one step is required' },
        { path: ['steps', 99, 'stepName'], message: 'Required' },
        { path: [], message: 'Invalid definition' },
      ],
      nodes,
      edges,
    })

    expect(issues).toHaveLength(3)
    for (const issue of issues) {
      expect(issue.nodeId).toBeUndefined()
      expect(issue.edgeId).toBeUndefined()
    }
    expect(issues[0].message).toBe('steps - At least one step is required')
    expect(issues[2].message).toBe('Invalid definition')
  })

  it('orders errors before warnings while keeping each group stable', () => {
    const graphErrors: ValidationError[] = [
      { type: 'warning', message: 'first warning' },
      { type: 'error', message: 'first error' },
      { type: 'warning', message: 'second warning' },
    ]

    const issues = collectValidationIssues({
      graphErrors,
      zodIssues: [{ path: ['steps', 0, 'stepType'], message: 'Invalid' }],
      nodes,
      edges,
    })

    expect(issues.map((issue) => issue.severity)).toEqual(['error', 'error', 'warning', 'warning'])
    expect(issues[0].message).toBe('first error')
    expect(issues[1].message).toBe('steps.0.stepType - Invalid')
    expect(issues[2].message).toBe('first warning')
  })

  it('assigns unique ids across graph and schema issues', () => {
    const issues = collectValidationIssues({
      graphErrors: [{ type: 'error', message: 'graph issue' }],
      zodIssues: [{ path: ['steps', 0, 'stepId'], message: 'schema issue' }],
      nodes,
      edges,
    })

    const ids = issues.map((issue) => issue.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('countIssuesBySeverity', () => {
  it('counts errors and warnings', () => {
    const issues = collectValidationIssues({
      graphErrors: [
        { type: 'error', message: 'a' },
        { type: 'warning', message: 'b' },
        { type: 'warning', message: 'c' },
      ],
      nodes,
      edges,
    })

    expect(countIssuesBySeverity(issues)).toEqual({ errors: 1, warnings: 2 })
  })
})
