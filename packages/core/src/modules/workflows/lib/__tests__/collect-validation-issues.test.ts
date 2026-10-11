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

  it('maps config warnings on transitions to the edge with warning severity', () => {
    const issues = collectValidationIssues({
      graphErrors: [],
      configWarnings: [
        { path: ['transitions', 1, 'activities', 0, 'config', 'to'], message: 'SEND_EMAIL requires "to"' },
      ],
      nodes,
      edges,
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      message: 'transitions.1.activities.0.config.to - SEND_EMAIL requires "to"',
      edgeId: 'e-step1-end',
    })
    expect(issues[0].nodeId).toBeUndefined()
  })

  it('maps config warnings on steps to the node and orders them after errors', () => {
    const issues = collectValidationIssues({
      graphErrors: [{ type: 'error', message: 'graph issue' }],
      configWarnings: [
        { path: ['steps', 1, 'activities', 0, 'config', 'eventName'], message: 'EMIT_EVENT requires "eventName"' },
      ],
      nodes,
      edges,
    })

    expect(issues.map((issue) => issue.severity)).toEqual(['error', 'warning'])
    expect(issues[1]).toMatchObject({
      severity: 'warning',
      nodeId: 'step1',
      nodeLabel: 'Review Request',
    })
  })
})

describe('Phase 3a flow-logic and ledger checks (step 2.12)', () => {
  const flowNodes: Node[] = [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
    { id: 'gate', type: 'ifElse', position: { x: 0, y: 50 }, data: { label: 'Gate' } },
    { id: 'wait', type: 'waitForCondition', position: { x: 0, y: 100 }, data: { label: 'Await payment' } },
    { id: 'handler', type: 'automated', position: { x: 0, y: 150 }, data: { label: 'Handler' } },
    { id: 'end', type: 'end', position: { x: 0, y: 200 }, data: { label: 'End' } },
  ]
  const flowEdges: Edge[] = [
    { id: 'e_start_gate', source: 'start', target: 'gate', data: {} },
    { id: 'e_gate_wait', source: 'gate', target: 'wait', data: {} },
    { id: 'e_gate_end', source: 'gate', target: 'end', data: {} },
    { id: 'e_wait_end', source: 'wait', target: 'end', data: {} },
    { id: 'e_wait_handler', source: 'wait', target: 'handler', data: { kind: 'error' } },
  ]
  const eq = (field: string, value: string) => ({ operator: 'AND', rules: [{ field, operator: '==', value }] })

  const ledger = {
    steps: {
      wait: { entries: [{ path: 'orderId', type: 'string', presence: 'always', source: 'start' }] },
      end: { entries: [{ path: 'orderId', type: 'string', presence: 'always', source: 'start' }] },
    },
  } as never

  it('reports an error route that shares its source and target with a normal route', () => {
    const definition = {
      steps: [{ stepId: 'start' }, { stepId: 'gate' }, { stepId: 'wait' }, { stepId: 'handler' }, { stepId: 'end' }],
      transitions: [
        { transitionId: 'e_wait_end', fromStepId: 'wait', toStepId: 'end' },
        { transitionId: 'e_wait_handler', fromStepId: 'wait', toStepId: 'end', kind: 'error' },
      ],
    }

    const issues = collectValidationIssues({ graphErrors: [], nodes: flowNodes, edges: flowEdges, definition })

    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].message).toContain('e_wait_handler')
  })

  it('reports a dangling error route pointing at a step that no longer exists', () => {
    const definition = {
      steps: [{ stepId: 'start' }, { stepId: 'wait' }],
      transitions: [{ transitionId: 'e_wait_gone', fromStepId: 'wait', toStepId: 'deleted', kind: 'error' }],
    }

    const issues = collectValidationIssues({ graphErrors: [], nodes: flowNodes, edges: flowEdges, definition })

    expect(issues.map((issue) => issue.severity)).toEqual(['warning'])
    expect(issues[0].message).toContain('deleted')
  })

  it('reports a branching step with no otherwise route and a duplicate case value', () => {
    const definition = {
      steps: [{ stepId: 'gate', stepType: 'SWITCH' }],
      transitions: [
        { transitionId: 't1', fromStepId: 'gate', toStepId: 'wait', condition: eq('status', 'NEW') },
        { transitionId: 't2', fromStepId: 'gate', toStepId: 'end', condition: eq('status', 'NEW') },
      ],
    }

    const issues = collectValidationIssues({ graphErrors: [], nodes: flowNodes, edges: flowEdges, definition })

    expect(issues.map((issue) => issue.severity)).toEqual(['warning', 'warning'])
    expect(issues.some((issue) => issue.message.includes('no unconditioned route'))).toBe(true)
    expect(issues.some((issue) => issue.message.includes('status=NEW'))).toBe(true)
  })

  it('reports a WAIT_FOR_CONDITION predicate referencing an unknown ledger path', () => {
    const definition = {
      steps: [
        { stepId: 'start' },
        { stepId: 'gate' },
        { stepId: 'wait', stepType: 'WAIT_FOR_CONDITION', config: { condition: eq('payment.status', 'PAID') } },
      ],
      transitions: [],
    }

    const issues = collectValidationIssues({ graphErrors: [], nodes: flowNodes, edges: flowEdges, definition, ledger })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'warning', nodeId: 'wait' })
    expect(issues[0].message).toContain('payment.status')
  })

  it('accepts a predicate whose path the ledger provides, and skips the check without a ledger', () => {
    const definition = {
      steps: [{ stepId: 'wait', stepType: 'WAIT_FOR_CONDITION', config: { condition: eq('orderId', 'X') } }],
      transitions: [],
    }

    expect(collectValidationIssues({ graphErrors: [], nodes: flowNodes, edges: flowEdges, definition, ledger })).toEqual([])
    expect(
      collectValidationIssues({
        graphErrors: [],
        nodes: flowNodes,
        edges: flowEdges,
        definition: {
          steps: [{ stepId: 'wait', stepType: 'WAIT_FOR_CONDITION', config: { condition: eq('missing.path', 'X') } }],
          transitions: [],
        },
      }),
    ).toEqual([])
  })

  it('reports a route condition broken by an upstream change', () => {
    const definition = {
      steps: [{ stepId: 'gate' }, { stepId: 'end' }],
      transitions: [
        { transitionId: 'e_start_gate', fromStepId: 'start', toStepId: 'gate' },
        { transitionId: 'e_gate_wait', fromStepId: 'gate', toStepId: 'wait' },
        { transitionId: 'e_gate_end', fromStepId: 'gate', toStepId: 'end', condition: eq('renamed.output', 'OK') },
      ],
    }

    const issues = collectValidationIssues({ graphErrors: [], nodes: flowNodes, edges: flowEdges, definition, ledger })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'warning', edgeId: 'e_gate_end' })
    expect(issues[0].message).toContain('renamed.output')
  })

  it('never blocks a save: every flow-logic finding is a warning, errors still come from the graph', () => {
    const definition = {
      steps: [
        { stepId: 'gate', stepType: 'IF_ELSE' },
        { stepId: 'wait', stepType: 'WAIT_FOR_CONDITION', config: { condition: eq('nope', 'X') } },
      ],
      transitions: [
        { transitionId: 't1', fromStepId: 'gate', toStepId: 'wait', condition: eq('status', 'NEW') },
        { transitionId: 't2', fromStepId: 'wait', toStepId: 'gone', kind: 'error' },
      ],
    }

    const issues = collectValidationIssues({
      graphErrors: [{ type: 'error', message: 'structural problem' }],
      nodes: flowNodes,
      edges: flowEdges,
      definition,
      ledger,
    })

    const { errors, warnings } = countIssuesBySeverity(issues)
    expect(errors).toBe(1)
    expect(warnings).toBeGreaterThanOrEqual(3)
    expect(issues[0].message).toBe('structural problem')
  })

  it('routes messages through the supplied translator', () => {
    const translate = jest.fn(() => 'translated')
    const definition = {
      steps: [{ stepId: 'gate', stepType: 'IF_ELSE' }],
      transitions: [{ transitionId: 't1', fromStepId: 'gate', toStepId: 'wait', condition: eq('status', 'NEW') }],
    }

    const issues = collectValidationIssues({ graphErrors: [], nodes: flowNodes, edges: flowEdges, definition, translate })

    expect(issues[0].message).toBe('translated')
    expect(translate).toHaveBeenCalledWith(
      'workflows.visualEditor.problems.branchingWithoutOtherwise',
      expect.any(String),
      expect.objectContaining({ stepId: 'gate' }),
    )
  })

  it('does nothing when no definition is supplied', () => {
    expect(collectValidationIssues({ graphErrors: [], nodes: flowNodes, edges: flowEdges })).toEqual([])
  })
})

describe('§6.4 task checks carry their own severity', () => {
  const taskNodes: Node[] = [
    { id: 'approve', type: 'userTask', position: { x: 0, y: 0 }, data: { label: 'Approve order' } },
  ]

  it('a task nobody owns is a WARNING, so it reports without blocking the save', () => {
    // The save gate counts ERRORS only, so severity here is the difference
    // between "you should fix this" and "you cannot save until you do".
    // Reassignment is the runtime remedy for a task that belongs to nobody, and
    // a definition authored before this check existed must stay saveable.
    const definition = {
      steps: [{ stepId: 'approve', stepType: 'USER_TASK', userTaskConfig: { formKey: 'approval' } }],
      transitions: [],
    }

    const issues = collectValidationIssues({
      graphErrors: [],
      nodes: taskNodes,
      edges: [],
      definition,
    })

    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
    // Mapped onto the node so the panel can select it.
    expect(issues[0].nodeId).toBe('approve')
    expect(countIssuesBySeverity(issues)).toEqual({ errors: 0, warnings: 1 })
  })

  it('an unresolvable binding type stays an ERROR — nothing at runtime repairs a typo', () => {
    const definition = {
      steps: [
        {
          stepId: 'approve',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedToRoles: ['approver'],
            entityBindings: [{ entityType: 'not an entity' }],
          },
        },
      ],
      transitions: [],
    }

    const issues = collectValidationIssues({
      graphErrors: [],
      nodes: taskNodes,
      edges: [],
      definition,
    })

    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('error')
    expect(countIssuesBySeverity(issues)).toEqual({ errors: 1, warnings: 0 })
  })

  it('an unviewable binding stays a WARNING, so the definition remains saveable', () => {
    const definition = {
      steps: [
        {
          stepId: 'approve',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedToRoles: ['approver'],
            entityBindings: [{ entityType: 'customers:customer_deal' }],
          },
        },
      ],
      transitions: [],
    }

    const issues = collectValidationIssues({
      graphErrors: [],
      nodes: taskNodes,
      edges: [],
      definition,
      knownEntityIds: new Set(['customers:customer_deal']),
      assigneeEntityAccess: {
        roleFeatures: { approver: ['workflows.tasks.view'] },
        entityViewRequirements: { 'customers:customer_deal': ['customers.deals.view'] },
      },
    })

    expect(countIssuesBySeverity(issues)).toEqual({ errors: 0, warnings: 1 })
  })

  it('a well-formed task raises nothing at all', () => {
    const definition = {
      steps: [
        {
          stepId: 'approve',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedToRoles: ['approver'],
            entityBindings: [{ entityType: 'customers:deal' }],
          },
        },
      ],
      transitions: [],
    }

    expect(
      collectValidationIssues({ graphErrors: [], nodes: taskNodes, edges: [], definition }),
    ).toEqual([])
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
