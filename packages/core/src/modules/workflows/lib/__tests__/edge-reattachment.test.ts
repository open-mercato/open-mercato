/**
 * Route reattachment (#4233, spec section 4.1).
 *
 * Re-targeting a route must preserve everything the author configured on it —
 * above all the durable transition id minted in step 3.1 — and must refuse
 * targets that would break an invariant instead of silently reverting.
 */

import { describe, test, expect } from '@jest/globals'
import type { Node, Edge } from '@xyflow/react'
import { reattachWorkflowEdge } from '../edge-reattachment'
import { ERROR_SOURCE_HANDLE_ID } from '../error-routing'
import { DATA_MAPPING_EDGE_TYPE } from '../data-edge-mapping'

const node = (id: string, type: string, config?: Record<string, unknown>): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, ...(config ? { config } : {}) },
})

const linearNodes: Node[] = [
  node('start', 'start'),
  node('task', 'automated'),
  node('approve', 'userTask'),
  node('review', 'userTask'),
  node('end', 'end'),
]

const configuredRoute: Edge = {
  id: 't_abc_1',
  source: 'task',
  target: 'end',
  type: 'workflowTransition',
  data: {
    trigger: 'auto',
    transitionName: 'Approved',
    label: 'Approved',
    priority: 40,
    condition: { operator: 'AND', conditions: [{ field: 'amount', operator: 'gt', value: 5000 }] },
    activities: [{ activityId: 'notify', activityName: 'Notify', activityType: 'SEND_EMAIL', config: { to: 'a@b.c' } }],
    preConditions: [{ ruleId: 'rule_1', required: true }],
    continueOnActivityFailure: true,
  },
}

const linearEdges: Edge[] = [
  { id: 't_start', source: 'start', target: 'task', type: 'workflowTransition', data: { trigger: 'auto' } },
  { id: 't_approve', source: 'task', target: 'approve', type: 'workflowTransition', data: { trigger: 'auto' } },
  { id: 't_review', source: 'review', target: 'end', type: 'workflowTransition', data: { trigger: 'auto' } },
  configuredRoute,
]

describe('reattachWorkflowEdge — preservation', () => {
  test('re-targets the route while keeping its id and every configured field', () => {
    const result = reattachWorkflowEdge(linearNodes, linearEdges, 't_abc_1', {
      source: 'task',
      target: 'review',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.edge.id).toBe('t_abc_1')
    expect(result.edge.source).toBe('task')
    expect(result.edge.target).toBe('review')
    expect(result.edge.data).toEqual(configuredRoute.data)
    expect(result.edges).toHaveLength(linearEdges.length)
    expect(result.edges.filter((edge) => edge.id === 't_abc_1')).toHaveLength(1)
  })

  test('moving the source endpoint keeps the route identity too', () => {
    const result = reattachWorkflowEdge(linearNodes, linearEdges, 't_abc_1', {
      source: 'approve',
      target: 'end',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.edge.id).toBe('t_abc_1')
    expect(result.edge.source).toBe('approve')
    expect((result.edge.data as { transitionName?: string }).transitionName).toBe('Approved')
  })

  test('the input edge list is never mutated', () => {
    const snapshot = JSON.stringify(linearEdges)
    reattachWorkflowEdge(linearNodes, linearEdges, 't_abc_1', { source: 'task', target: 'review' })
    expect(JSON.stringify(linearEdges)).toBe(snapshot)
  })
})

describe('reattachWorkflowEdge — refusals', () => {
  test('refuses a self-loop', () => {
    const result = reattachWorkflowEdge(linearNodes, linearEdges, 't_abc_1', { source: 'task', target: 'task' })
    expect(result).toMatchObject({ ok: false, code: 'selfLoop' })
  })

  test('refuses a duplicate of an existing route', () => {
    const duplicate = reattachWorkflowEdge(linearNodes, linearEdges, 't_abc_1', { source: 'task', target: 'approve' })
    expect(duplicate).toMatchObject({ ok: false, code: 'duplicateRoute' })
  })

  test('refuses an incomplete connection and an unknown step', () => {
    expect(reattachWorkflowEdge(linearNodes, linearEdges, 't_abc_1', { source: 'task', target: null }))
      .toMatchObject({ ok: false, code: 'incompleteConnection' })
    expect(reattachWorkflowEdge(linearNodes, linearEdges, 't_abc_1', { source: 'task', target: 'ghost' }))
      .toMatchObject({ ok: false, code: 'unknownStep' })
  })

  test('refuses to reattach a data-mapping link', () => {
    const dataEdge: Edge = { id: 'data_1', source: 'task', target: 'review', type: DATA_MAPPING_EDGE_TYPE, data: {} }
    const result = reattachWorkflowEdge(linearNodes, [...linearEdges, dataEdge], 'data_1', {
      source: 'task',
      target: 'end',
    })
    expect(result).toMatchObject({ ok: false, code: 'dataMappingRoute' })
  })

  test('refuses endpoints that would leave a step disconnected', () => {
    const pairNodes = [...linearNodes, node('draft', 'automated'), node('sign', 'userTask')]
    const pairEdges: Edge[] = [
      ...linearEdges,
      { id: 't_pair', source: 'draft', target: 'sign', type: 'workflowTransition', data: { trigger: 'auto' } },
    ]

    const result = reattachWorkflowEdge(pairNodes, pairEdges, 't_pair', { source: 'approve', target: 'end' })
    expect(result).toMatchObject({ ok: false, code: 'graphInvalid' })
    if (result.ok) return
    expect(result.detail).toMatch(/draft|sign/)
  })

  test('accepts a target when the graph already has that error (no new violation)', () => {
    const brokenNodes = [...linearNodes, node('lonely', 'automated')]
    const result = reattachWorkflowEdge(brokenNodes, linearEdges, 't_abc_1', { source: 'task', target: 'review' })
    expect(result.ok).toBe(true)
  })
})

describe('reattachWorkflowEdge — error routes', () => {
  const errorRoute: Edge = {
    id: 't_err',
    source: 'task',
    target: 'review',
    type: 'workflowTransition',
    sourceHandle: ERROR_SOURCE_HANDLE_ID,
    data: { trigger: 'auto', kind: 'error' },
  }
  const errorEdges: Edge[] = [
    { id: 't_start', source: 'start', target: 'task', type: 'workflowTransition', data: { trigger: 'auto' } },
    { id: 't_happy', source: 'task', target: 'end', type: 'workflowTransition', data: { trigger: 'auto' } },
    { id: 't_review', source: 'review', target: 'end', type: 'workflowTransition', data: { trigger: 'auto' } },
    errorRoute,
  ]

  test('keeps the error handle and kind when the target moves', () => {
    const result = reattachWorkflowEdge(linearNodes, errorEdges, 't_err', { source: 'task', target: 'end' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.edge.sourceHandle).toBe(ERROR_SOURCE_HANDLE_ID)
    expect((result.edge.data as { kind?: string }).kind).toBe('error')
  })

  test('refuses to start an error route at a step that cannot raise one', () => {
    const result = reattachWorkflowEdge(linearNodes, errorEdges, 't_err', { source: 'start', target: 'review' })
    expect(result).toMatchObject({ ok: false, code: 'errorHandleUnsupported' })
  })
})

describe('reattachWorkflowEdge — fork branches', () => {
  const forkNodes: Node[] = [
    node('start', 'start'),
    node('fork', 'parallelFork', { joinStepId: 'join' }),
    node('left', 'automated'),
    node('right', 'automated'),
    node('join', 'parallelJoin', { forkStepId: 'fork' }),
    node('after', 'automated'),
    node('end', 'end'),
  ]
  const forkEdges: Edge[] = [
    { id: 't_in', source: 'start', target: 'fork', type: 'workflowTransition', data: { trigger: 'auto' } },
    { id: 't_left', source: 'fork', target: 'left', type: 'workflowTransition', data: { trigger: 'auto' } },
    { id: 't_right', source: 'fork', target: 'right', type: 'workflowTransition', data: { trigger: 'auto' } },
    { id: 't_left_join', source: 'left', target: 'join', type: 'workflowTransition', data: { trigger: 'auto' } },
    { id: 't_right_join', source: 'right', target: 'join', type: 'workflowTransition', data: { trigger: 'auto' } },
    { id: 't_out', source: 'join', target: 'after', type: 'workflowTransition', data: { trigger: 'auto' } },
    { id: 't_done', source: 'after', target: 'end', type: 'workflowTransition', data: { trigger: 'auto' } },
  ]

  test('refuses a branch endpoint that no longer converges on the join', () => {
    const result = reattachWorkflowEdge(forkNodes, forkEdges, 't_left_join', { source: 'left', target: 'after' })
    expect(result).toMatchObject({ ok: false, code: 'forkJoinInvalid' })
  })

  test('accepts moving a branch onto another in-region step that still converges', () => {
    const withRelay: Node[] = [...forkNodes, node('relay', 'automated')]
    const withRelayEdges: Edge[] = [
      ...forkEdges,
      { id: 't_relay_join', source: 'relay', target: 'join', type: 'workflowTransition', data: { trigger: 'auto' } },
    ]

    const result = reattachWorkflowEdge(withRelay, withRelayEdges, 't_left_join', { source: 'left', target: 'relay' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.edge.id).toBe('t_left_join')
    expect(result.edge.target).toBe('relay')
  })
})
