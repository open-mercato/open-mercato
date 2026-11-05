/**
 * Step 2.11 (workflows UX Phase 3a): route priority becomes drag-to-reorder and
 * the number is derived. Pins the normalization pass (legacy definitions mix the
 * dialog default 100 with the schema default 0), the reorder round-trip, and the
 * error-route exclusion.
 */
import type { Edge } from '@xyflow/react'
import {
  applyDerivedPriorities,
  applyRouteOrder,
  derivePriorities,
  moveRoute,
  needsPriorityNormalization,
  normalizeRoutePriorities,
  orderRoutesByPriority,
  outgoingNormalRoutes,
  readRouteOrder,
  ROUTE_PRIORITY_OTHERWISE,
  ROUTE_PRIORITY_TOP,
} from '../route-priority'

const edge = (id: string, target: string, data: Record<string, unknown> = {}): Edge => ({
  id,
  source: 'gate',
  target,
  type: 'workflowTransition',
  data: { trigger: 'auto', ...data },
})

const condition = (field: string) => ({ operator: 'AND', rules: [{ field, operator: '=', value: 'X' }] })

describe('outgoingNormalRoutes', () => {
  it('excludes error routes and data-mapping edges', () => {
    const edges: Edge[] = [
      edge('a', 'one'),
      { ...edge('err', 'handler'), data: { kind: 'error' } },
      { ...edge('map', 'sub'), type: 'workflowDataMapping' },
      { ...edge('other', 'x'), source: 'elsewhere' },
    ]
    expect(outgoingNormalRoutes(edges, 'gate').map((entry) => entry.id)).toEqual(['a'])
  })
})

describe('orderRoutesByPriority', () => {
  it('sorts by priority descending and keeps definition order on ties', () => {
    const edges = [
      edge('a', 'one', { priority: 100 }),
      edge('b', 'two', { priority: 0 }),
      edge('c', 'three', { priority: 100 }),
    ]
    expect(orderRoutesByPriority(edges).map((entry) => entry.id)).toEqual(['a', 'c', 'b'])
  })

  it('treats a missing priority as 0', () => {
    const edges = [edge('a', 'one'), edge('b', 'two', { priority: 10 })]
    expect(orderRoutesByPriority(edges).map((entry) => entry.id)).toEqual(['b', 'a'])
  })
})

describe('derivePriorities', () => {
  it('spaces conditioned routes by 10 from 100 and gives the trailing default 0', () => {
    expect(
      derivePriorities([{ hasCondition: true }, { hasCondition: true }, { hasCondition: false }]),
    ).toEqual([ROUTE_PRIORITY_TOP, 90, ROUTE_PRIORITY_OTHERWISE])
  })

  it('keeps every route positive when none is a default route', () => {
    expect(derivePriorities([{ hasCondition: true }, { hasCondition: true }])).toEqual([100, 90])
    expect(derivePriorities([{ hasCondition: false }, { hasCondition: false }])).toEqual([100, 90])
  })

  it('raises the top value so more than ten routes stay unique and non-negative', () => {
    const entries = Array.from({ length: 14 }, () => ({ hasCondition: true }))
    const derived = derivePriorities(entries)
    expect(new Set(derived).size).toBe(14)
    expect(Math.min(...derived)).toBeGreaterThanOrEqual(0)
    expect(derived[0]).toBe(140)
  })

  it('returns nothing for an empty list', () => {
    expect(derivePriorities([])).toEqual([])
  })
})

describe('normalizeRoutePriorities', () => {
  it('rewrites the legacy 100/100/0 mix to clean descending values without reordering', () => {
    const edges = [
      edge('a', 'one', { priority: 100, condition: condition('amount') }),
      edge('b', 'two', { priority: 100, condition: condition('status') }),
      edge('c', 'fallback', { priority: 0 }),
    ]

    const normalized = normalizeRoutePriorities(edges, 'gate')

    expect(normalized.map((entry) => [entry.id, entry.data?.priority])).toEqual([
      ['a', 100],
      ['b', 90],
      ['c', 0],
    ])
  })

  it('promotes a schema-default 0 route that already evaluated first', () => {
    const edges = [
      edge('a', 'one', { priority: 0, condition: condition('amount') }),
      edge('b', 'two', { priority: 0, condition: condition('status') }),
    ]

    const normalized = normalizeRoutePriorities(edges, 'gate')

    expect(normalized.map((entry) => entry.data?.priority)).toEqual([100, 90])
  })

  it('preserves the current evaluation order rather than inventing one', () => {
    const edges = [
      edge('low', 'one', { priority: 5, condition: condition('a') }),
      edge('high', 'two', { priority: 900, condition: condition('b') }),
    ]

    const normalized = normalizeRoutePriorities(edges, 'gate')

    expect(readRouteOrder(normalized, 'gate').map((entry) => entry.transitionId)).toEqual(['high', 'low'])
    expect(normalized.find((entry) => entry.id === 'high')?.data?.priority).toBe(100)
    expect(normalized.find((entry) => entry.id === 'low')?.data?.priority).toBe(90)
  })

  it('never touches error routes', () => {
    const errorEdge = { ...edge('err', 'handler', { priority: 7 }), data: { kind: 'error', priority: 7 } }
    const edges = [
      edge('a', 'one', { priority: 100, condition: condition('amount') }),
      edge('b', 'two', { priority: 100 }),
      errorEdge,
    ]

    const normalized = normalizeRoutePriorities(edges, 'gate')

    expect(normalized.find((entry) => entry.id === 'err')?.data).toEqual({ kind: 'error', priority: 7 })
  })

  it('is idempotent and a no-op for an already-clean or single-route node', () => {
    const edges = [
      edge('a', 'one', { priority: 100, condition: condition('amount') }),
      edge('b', 'fallback', { priority: 0 }),
    ]
    const once = normalizeRoutePriorities(edges, 'gate')
    expect(needsPriorityNormalization(once, 'gate')).toBe(false)
    expect(normalizeRoutePriorities(once, 'gate')).toBe(once)

    const single = [edge('a', 'one', { priority: 42 })]
    expect(needsPriorityNormalization(single, 'gate')).toBe(false)
    expect(normalizeRoutePriorities(single, 'gate')).toBe(single)
  })
})

describe('reorder round-trip', () => {
  it('moving a route to the top makes it evaluate first', () => {
    const edges = [
      edge('a', 'one', { priority: 100, condition: condition('amount') }),
      edge('b', 'two', { priority: 90, condition: condition('status') }),
      edge('c', 'fallback', { priority: 0 }),
    ]

    const entries = readRouteOrder(edges, 'gate')
    expect(entries.map((entry) => entry.transitionId)).toEqual(['a', 'b', 'c'])
    expect(entries[2].isOtherwise).toBe(true)

    const reordered = applyDerivedPriorities(moveRoute(entries, 1, 0))
    const nextEdges = applyRouteOrder(edges, 'gate', reordered)

    expect(readRouteOrder(nextEdges, 'gate').map((entry) => entry.transitionId)).toEqual(['b', 'a', 'c'])
    expect(nextEdges.map((entry) => entry.data?.priority)).toEqual([90, 100, 0])
  })

  it('only rewrites the priority of the edited node’s own routes', () => {
    const edges = [
      edge('a', 'one', { priority: 100, condition: condition('amount') }),
      edge('b', 'two', { priority: 90 }),
      { ...edge('foreign', 'x', { priority: 100 }), source: 'other-step' },
    ]

    const next = applyRouteOrder(edges, 'gate', applyDerivedPriorities(readRouteOrder(edges, 'gate')))

    expect(next.find((entry) => entry.id === 'foreign')?.data?.priority).toBe(100)
    expect(next.find((entry) => entry.id === 'a')?.data).toMatchObject({ trigger: 'auto', condition: expect.anything() })
  })

  it('moveRoute clamps out-of-range targets and ignores a no-op move', () => {
    const entries = readRouteOrder([edge('a', 'one'), edge('b', 'two')], 'gate')
    expect(moveRoute(entries, 0, 0)).toBe(entries)
    expect(moveRoute(entries, 5, 0)).toBe(entries)
    expect(moveRoute(entries, 0, 9).map((entry) => entry.transitionId)).toEqual(['b', 'a'])
  })
})
