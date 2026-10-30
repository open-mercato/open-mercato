/**
 * Step 2.10 (workflows UX Phase 3a, issue #4244): route condition/activity
 * chips. The chip model is DERIVED — these tests pin the compact condition
 * rendering, the 3-chip cap with overflow, and the `otherwise` inference, and a
 * graph round-trip proves chips never change the saved definition shape.
 */
import type { Edge, Node } from '@xyflow/react'
import {
  buildRouteChipModel,
  routeCarriesCondition,
  summarizeConditionExpression,
  ROUTE_CHIP_LIMIT,
  ROUTE_CHIP_ZOOM_THRESHOLD,
} from '../route-chips'
import { definitionToGraph, graphToDefinition } from '../graph-utils'

const activity = (activityType: string, index: number) => ({
  activityId: `a${index}`,
  activityName: `Activity ${index}`,
  activityType,
  config: {},
})

describe('summarizeConditionExpression', () => {
  it('renders a simple condition as field op value', () => {
    expect(summarizeConditionExpression({ field: 'amount', operator: '>', value: 5000 })).toBe('amount > 5000')
  })

  it('normalizes == to = and reads a group down to its first rule', () => {
    expect(
      summarizeConditionExpression({ operator: 'AND', rules: [{ field: 'status', operator: '==', value: 'NEW' }] }),
    ).toBe('status = NEW')
  })

  it('suffixes +N when a group carries more rules', () => {
    expect(
      summarizeConditionExpression({
        operator: 'AND',
        rules: [
          { field: 'amount', operator: '>', value: 10 },
          { field: 'status', operator: '=', value: 'NEW' },
          { field: 'region', operator: '=', value: 'EU' },
        ],
      }),
    ).toBe('amount > 10 +2')
  })

  it('omits the value for valueless operators and renders a compared field', () => {
    expect(summarizeConditionExpression({ field: 'note', operator: 'IS_EMPTY', value: null })).toBe('note IS_EMPTY')
    expect(
      summarizeConditionExpression({ field: 'total', operator: '>', value: null, valueField: 'limit' }),
    ).toBe('total > limit')
  })

  it('elides an over-long summary instead of stretching the edge', () => {
    const summary = summarizeConditionExpression({
      field: 'customer.billingAddress.postalCode',
      operator: '=',
      value: '00-001',
    })
    expect(summary).toHaveLength(28)
    expect(summary?.endsWith('…')).toBe(true)
  })

  it('returns null when there is nothing to summarize', () => {
    expect(summarizeConditionExpression(null)).toBeNull()
    expect(summarizeConditionExpression(undefined)).toBeNull()
    expect(summarizeConditionExpression({ operator: 'AND', rules: [] })).toBeNull()
    expect(summarizeConditionExpression('amount > 5000')).toBeNull()
  })
})

describe('buildRouteChipModel', () => {
  it('caps activity chips at the limit and reports the overflow', () => {
    const model = buildRouteChipModel({
      activities: [0, 1, 2, 3, 4].map((index) => activity('SEND_EMAIL', index)),
    })
    expect(model.activities).toHaveLength(ROUTE_CHIP_LIMIT)
    expect(model.overflowCount).toBe(2)
  })

  it('does not report overflow at or below the cap', () => {
    const model = buildRouteChipModel({ activities: [0, 1, 2].map((index) => activity('WAIT', index)) })
    expect(model.activities).toHaveLength(3)
    expect(model.overflowCount).toBe(0)
  })

  it('marks the unconditioned route as otherwise only when a sibling is conditioned', () => {
    expect(buildRouteChipModel({ hasConditionedSibling: true }).isOtherwise).toBe(true)
    expect(buildRouteChipModel({ hasConditionedSibling: false }).isOtherwise).toBe(false)
    expect(
      buildRouteChipModel({
        condition: { field: 'amount', operator: '>', value: 1 },
        hasConditionedSibling: true,
      }).isOtherwise,
    ).toBe(false)
    expect(
      buildRouteChipModel({ preConditions: [{ ruleId: 'R', required: true }], hasConditionedSibling: true }).isOtherwise,
    ).toBe(false)
  })

  it('is empty when the route carries nothing worth rendering', () => {
    expect(buildRouteChipModel({}).isEmpty).toBe(true)
    expect(buildRouteChipModel({ activities: [] }).isEmpty).toBe(true)
    expect(buildRouteChipModel({ activities: [activity('WAIT', 0)] }).isEmpty).toBe(false)
  })

  it('ignores malformed activity entries', () => {
    const model = buildRouteChipModel({ activities: [null, 'nope', { activityId: 'x' }, activity('WAIT', 1)] })
    expect(model.activities).toEqual([{ activityId: 'a1', activityType: 'WAIT' }])
  })

  it('keeps the semantic-zoom threshold below 1 so default zoom shows chips', () => {
    expect(ROUTE_CHIP_ZOOM_THRESHOLD).toBeLessThan(1)
  })
})

describe('routeCarriesCondition', () => {
  it('accepts either an inline expression or a business-rule reference', () => {
    expect(routeCarriesCondition({ condition: { field: 'a', operator: '=', value: 1 } })).toBe(true)
    expect(routeCarriesCondition({ preConditions: [{ ruleId: 'R', required: true }] })).toBe(true)
    expect(routeCarriesCondition({ preConditions: [] })).toBe(false)
    expect(routeCarriesCondition({})).toBe(false)
  })
})

describe('chips never mutate the saved definition shape', () => {
  const definition = {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
      { stepId: 'approve', stepName: 'Approve', stepType: 'USER_TASK' as const },
      { stepId: 'end', stepName: 'End', stepType: 'END' as const },
    ],
    transitions: [
      {
        transitionId: 'e_start_approve',
        fromStepId: 'start',
        toStepId: 'approve',
        trigger: 'auto' as const,
        priority: 100,
        condition: { operator: 'AND', rules: [{ field: 'amount', operator: '>', value: 5000 }] },
        activities: [activity('SEND_EMAIL', 1), activity('CALL_API', 2), activity('WAIT', 3), activity('EMIT_EVENT', 4)],
      },
      {
        transitionId: 'e_start_end',
        fromStepId: 'start',
        toStepId: 'end',
        trigger: 'auto' as const,
        priority: 0,
      },
    ],
  }

  it('round-trips a chip-bearing graph unchanged', () => {
    const { nodes, edges } = definitionToGraph(definition as never, { autoLayout: false })

    // Building the chip models is the exact work the edge component does per render.
    const models = edges.map((edge: Edge) =>
      buildRouteChipModel({
        condition: edge.data?.condition,
        preConditions: edge.data?.preConditions,
        activities: edge.data?.activities,
        hasConditionedSibling: edges.some(
          (other: Edge) => other.source === edge.source && other.id !== edge.id && routeCarriesCondition(other.data ?? {}),
        ),
      }),
    )
    expect(models[0].overflowCount).toBe(1)
    expect(models[1].isOtherwise).toBe(true)

    const rebuilt = graphToDefinition(nodes as Node[], edges)
    const rebuiltTransitions = rebuilt.transitions.map((transition) => {
      const { _editorPosition: _ignored, ...rest } = transition as Record<string, unknown>
      return rest
    })
    expect(rebuiltTransitions).toEqual([
      expect.objectContaining({
        transitionId: 'e_start_approve',
        condition: definition.transitions[0].condition,
        priority: 100,
      }),
      expect.objectContaining({ transitionId: 'e_start_end', priority: 0 }),
    ])
    expect(rebuilt.transitions[0]).not.toHaveProperty('chips')
    expect(rebuilt.transitions[0]).not.toHaveProperty('isOtherwise')
    expect(rebuilt.transitions[1]).not.toHaveProperty('condition')
    expect(rebuilt.transitions[0].activities).toHaveLength(4)
  })
})
