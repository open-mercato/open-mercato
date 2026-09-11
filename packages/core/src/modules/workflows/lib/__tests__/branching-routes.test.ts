import { describe, test, expect } from '@jest/globals'
import type { Edge } from '@xyflow/react'
import {
  applyIfElseRoutes,
  applySwitchRoutes,
  buildCaseCondition,
  collectDuplicateCaseValues,
  ensureOtherwiseRoute,
  isBranchingNodeType,
  readBranchingRoutes,
  readSwitchField,
  type BranchingRouteDraft,
} from '../branching-routes'
import { graphToDefinition } from '../graph-utils'

function routeEdge(id: string, target: string, data: Record<string, unknown> = {}): Edge {
  return {
    id,
    source: 'branch',
    target,
    type: 'workflowTransition',
    data: { trigger: 'auto', preConditions: [], postConditions: [], activities: [], ...data },
  } as Edge
}

const baseEdges: Edge[] = [
  { id: 'e_start_branch', source: 'start', target: 'branch', type: 'workflowTransition', data: {} } as Edge,
  routeEdge('e_branch_approve', 'approve'),
  routeEdge('e_branch_reject', 'reject'),
]

describe('branching routes (transition sugar)', () => {
  test('recognizes the branching node types', () => {
    expect(isBranchingNodeType('ifElse')).toBe(true)
    expect(isBranchingNodeType('switch')).toBe(true)
    expect(isBranchingNodeType('automated')).toBe(false)
    expect(isBranchingNodeType(undefined)).toBe(false)
  })

  test('reads outgoing routes and treats an unconditioned one as the otherwise route', () => {
    const routes = readBranchingRoutes(baseEdges, 'branch')
    expect(routes.map((route) => route.transitionId)).toEqual(['e_branch_approve', 'e_branch_reject'])
    expect(routes.every((route) => route.kind === 'otherwise')).toBe(true)
  })

  test('auto-creates exactly one otherwise route', () => {
    const routes = ensureOtherwiseRoute(readBranchingRoutes(baseEdges, 'branch'))
    expect(routes.map((route) => route.kind)).toEqual(['case', 'otherwise'])
    expect(routes.filter((route) => route.kind === 'otherwise')).toHaveLength(1)
  })

  test('compiles an If/Else inline condition onto the case route only', () => {
    const condition = buildCaseCondition('total', '100')
    const routes: BranchingRouteDraft[] = [
      { transitionId: 'e_branch_approve', toStepId: 'approve', kind: 'case', mode: 'inline', condition },
      { transitionId: 'e_branch_reject', toStepId: 'reject', kind: 'otherwise', mode: 'inline' },
    ]

    const applied = applyIfElseRoutes(baseEdges, 'branch', routes)
    const approve = applied.find((edge) => edge.id === 'e_branch_approve')!.data as Record<string, unknown>
    const reject = applied.find((edge) => edge.id === 'e_branch_reject')!.data as Record<string, unknown>

    expect(approve.condition).toEqual(condition)
    expect(approve.priority).toBe(100)
    expect(reject.condition).toBeUndefined()
    expect(reject.priority).toBe(0)
    expect(applied.find((edge) => edge.id === 'e_start_branch')).toBe(baseEdges[0])
  })

  test('compiles the "use Business Rule instead" mode into a preConditions reference', () => {
    const routes: BranchingRouteDraft[] = [
      {
        transitionId: 'e_branch_approve',
        toStepId: 'approve',
        kind: 'case',
        mode: 'rule',
        ruleId: 'high-value-order',
      },
      { transitionId: 'e_branch_reject', toStepId: 'reject', kind: 'otherwise', mode: 'inline' },
    ]

    const applied = applyIfElseRoutes(baseEdges, 'branch', routes)
    const approve = applied.find((edge) => edge.id === 'e_branch_approve')!.data as Record<string, unknown>

    expect(approve.condition).toBeUndefined()
    expect(approve.preConditions).toEqual([{ ruleId: 'high-value-order', required: true }])
    expect(readBranchingRoutes(applied, 'branch')[0]).toMatchObject({ mode: 'rule', ruleId: 'high-value-order' })
  })

  test('compiles Switch cases into generated field == value conditions with descending priority', () => {
    const edges = [...baseEdges, routeEdge('e_branch_fallback', 'fallback')]
    const applied = applySwitchRoutes(edges, 'branch', {
      field: 'order.status',
      routes: [
        {
          transitionId: 'e_branch_approve',
          toStepId: 'approve',
          kind: 'case',
          mode: 'inline',
          caseLabel: 'Paid',
          caseValue: 'paid',
        },
        {
          transitionId: 'e_branch_reject',
          toStepId: 'reject',
          kind: 'case',
          mode: 'inline',
          caseLabel: 'Cancelled',
          caseValue: 'cancelled',
        },
        { transitionId: 'e_branch_fallback', toStepId: 'fallback', kind: 'otherwise', mode: 'inline' },
      ],
    })

    const dataById = new Map(applied.map((edge) => [edge.id, edge.data as Record<string, unknown>]))
    expect(dataById.get('e_branch_approve')!.condition).toEqual({
      operator: 'AND',
      rules: [{ field: 'order.status', operator: '==', value: 'paid' }],
    })
    expect(dataById.get('e_branch_reject')!.condition).toEqual({
      operator: 'AND',
      rules: [{ field: 'order.status', operator: '==', value: 'cancelled' }],
    })
    expect([
      dataById.get('e_branch_approve')!.priority,
      dataById.get('e_branch_reject')!.priority,
      dataById.get('e_branch_fallback')!.priority,
    ]).toEqual([100, 90, 0])
    expect(dataById.get('e_branch_fallback')!.condition).toBeUndefined()
    expect(readSwitchField(applied, 'branch')).toBe('order.status')
  })

  test('reopens Switch cases with their stored labels and values', () => {
    const applied = applySwitchRoutes(baseEdges, 'branch', {
      field: 'channel',
      routes: [
        {
          transitionId: 'e_branch_approve',
          toStepId: 'approve',
          kind: 'case',
          mode: 'inline',
          caseLabel: 'Web',
          caseValue: 'web',
        },
        { transitionId: 'e_branch_reject', toStepId: 'reject', kind: 'otherwise', mode: 'inline' },
      ],
    })

    expect(readBranchingRoutes(applied, 'branch')).toEqual([
      expect.objectContaining({ kind: 'case', caseLabel: 'Web', caseValue: 'web' }),
      expect.objectContaining({ kind: 'otherwise' }),
    ])
  })

  test('flags duplicate case values', () => {
    const routes: BranchingRouteDraft[] = [
      { transitionId: 'a', toStepId: 'x', kind: 'case', mode: 'inline', caseValue: 'paid' },
      { transitionId: 'b', toStepId: 'y', kind: 'case', mode: 'inline', caseValue: 'paid' },
      { transitionId: 'c', toStepId: 'z', kind: 'otherwise', mode: 'inline' },
    ]
    expect(collectDuplicateCaseValues(routes)).toEqual(['paid'])
  })

  test('stores nothing bespoke — compiled routes are plain transitions', () => {
    const nodes = [
      { id: 'branch', type: 'switch', position: { x: 0, y: 0 }, data: { label: 'Channel' } },
      { id: 'approve', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'Approve' } },
      { id: 'reject', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'Reject' } },
    ] as any

    const applied = applySwitchRoutes(baseEdges.slice(1), 'branch', {
      field: 'channel',
      routes: [
        {
          transitionId: 'e_branch_approve',
          toStepId: 'approve',
          kind: 'case',
          mode: 'inline',
          caseValue: 'web',
        },
        { transitionId: 'e_branch_reject', toStepId: 'reject', kind: 'otherwise', mode: 'inline' },
      ],
    })

    const definition = graphToDefinition(nodes, applied)
    const branchStep = definition.steps.find((step: any) => step.stepId === 'branch')
    expect(branchStep.stepType).toBe('SWITCH')
    for (const transition of definition.transitions) {
      expect(Object.keys(transition).sort((left, right) => left.localeCompare(right))).toEqual(
        expect.arrayContaining(['transitionId', 'fromStepId', 'toStepId'].sort((left, right) => left.localeCompare(right))),
      )
      expect(Object.keys(transition)).not.toContain('caseValue')
      expect(Object.keys(transition)).not.toContain('branchKey')
    }
    const cased = definition.transitions.find((transition: any) => transition.fromStepId === 'branch' && transition.condition)
    expect(cased.condition).toEqual({ operator: 'AND', rules: [{ field: 'channel', operator: '==', value: 'web' }] })
    expect(cased.priority).toBe(100)
  })
})
