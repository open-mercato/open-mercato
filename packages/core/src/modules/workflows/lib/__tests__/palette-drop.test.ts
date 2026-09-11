/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import type { Node, Edge } from '@xyflow/react'
import {
  WORKFLOW_PALETTE_DRAG_MIME,
  readPaletteDragItem,
  writePaletteDragPayload,
} from '../palette-drag'
import { appendActivityToRoute, insertStepOnRoute } from '../palette-drop'
import { resolveNewNodePlacement } from '../node-placement'
import { NODE_HEIGHT, NODE_MIN_WIDTH } from '../node-geometry'

function fakeDataTransfer(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial }
  return {
    effectAllowed: 'none',
    get types() {
      return Object.keys(store)
    },
    getData: (type: string) => store[type] ?? '',
    setData: (type: string, value: string) => {
      store[type] = value
    },
  }
}

const nodes: Node[] = [
  { id: 'start_1', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
  { id: 'end_1', type: 'end', position: { x: 400, y: 0 }, data: { label: 'End' } },
]

const routeData = {
  trigger: 'auto',
  transitionName: 'approved',
  priority: 20,
  condition: 'amount > 100',
  activities: [{ activityId: 'activity_1', activityName: 'Notify', activityType: 'SEND_EMAIL', config: {} }],
}

const edges: Edge[] = [
  { id: 't_main', source: 'start_1', target: 'end_1', type: 'workflowTransition', data: { ...routeData } },
]

const droppedNode: Node = {
  id: 'automated_new',
  type: 'automated',
  position: { x: 200, y: 0 },
  data: { label: 'New Automated Task' },
}

describe('palette drag payload (spec section 4.2)', () => {
  test('carries a machine payload plus a readable text fallback', () => {
    const transfer = fakeDataTransfer()
    writePaletteDragPayload(transfer, { kind: 'step', nodeType: 'userTask' }, 'USER TASK')
    expect(transfer.getData('text/plain')).toBe('USER TASK')
    expect(JSON.parse(transfer.getData(WORKFLOW_PALETTE_DRAG_MIME))).toEqual({ kind: 'step', nodeType: 'userTask' })
    expect(readPaletteDragItem(transfer)).toEqual({ kind: 'step', nodeType: 'userTask' })
  })

  test('reads an action payload', () => {
    const transfer = fakeDataTransfer()
    writePaletteDragPayload(transfer, { kind: 'activity', activityType: 'SEND_EMAIL' }, 'Send email')
    expect(readPaletteDragItem(transfer)).toEqual({ kind: 'activity', activityType: 'SEND_EMAIL' })
  })

  test('ignores a drag that did not come from the palette', () => {
    expect(readPaletteDragItem(fakeDataTransfer({ 'text/plain': 'hello' }))).toBeNull()
    expect(readPaletteDragItem(fakeDataTransfer({ [WORKFLOW_PALETTE_DRAG_MIME]: 'not json' }))).toBeNull()
    expect(readPaletteDragItem(fakeDataTransfer({ [WORKFLOW_PALETTE_DRAG_MIME]: '{"kind":"note"}' }))).toBeNull()
    expect(readPaletteDragItem(null)).toBeNull()
  })
})

describe('drop position mapping (spec section 4.2)', () => {
  test('a drop centres the card on the cursor; a click appends after the right-most card', () => {
    // Derived from the shared node geometry rather than restated, so a card
    // resize never silently re-baselines this expectation.
    expect(resolveNewNodePlacement(nodes, { dropPosition: { x: 300, y: 400 } })).toEqual({
      x: 300 - NODE_MIN_WIDTH / 2,
      y: 400 - NODE_HEIGHT / 2,
    })
    expect(resolveNewNodePlacement(nodes)).toEqual({ x: 628, y: 0 })
  })

  test('a drop onto an occupied spot is nudged clear instead of hiding a card', () => {
    expect(resolveNewNodePlacement(nodes, { dropPosition: { x: 300, y: 120 } })).toEqual({
      x: 300 - NODE_MIN_WIDTH / 2,
      y: 120 - NODE_HEIGHT / 2 + NODE_HEIGHT + 48,
    })
  })
})

describe('insert-on-route splice (spec section 4.2)', () => {
  test('the first segment keeps the original route id and all of its configuration', () => {
    const result = insertStepOnRoute(nodes, edges, 't_main', droppedNode)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const first = result.edges.find((edge) => edge.id === 't_main')!
    expect(first.source).toBe('start_1')
    expect(first.target).toBe('automated_new')
    expect(first.data).toMatchObject(routeData)
  })

  test('the second segment is a fresh unconditional route to the original target', () => {
    const result = insertStepOnRoute(nodes, edges, 't_main', droppedNode)
    if (!result.ok) throw new Error('[internal] expected the splice to be accepted')

    const second = result.edges.find((edge) => edge.id !== 't_main')!
    expect(second.source).toBe('automated_new')
    expect(second.target).toBe('end_1')
    expect(second.id).not.toBe('t_main')
    expect(second.data).toMatchObject({ trigger: 'auto', activities: [], preConditions: [], postConditions: [] })
  })

  test('an error route stays the error path out of its step', () => {
    const errorEdges: Edge[] = [
      { id: 't_error', source: 'start_1', target: 'end_1', type: 'workflowTransition', data: { trigger: 'auto', kind: 'error' } },
    ]
    const result = insertStepOnRoute(nodes, errorEdges, 't_error', droppedNode)
    if (!result.ok) throw new Error('[internal] expected the splice to be accepted')
    expect(result.edges.find((edge) => edge.id === 't_error')!.data).toMatchObject({ kind: 'error' })
    expect(result.edges.find((edge) => edge.id !== 't_error')!.data).not.toMatchObject({ kind: 'error' })
  })

  test('the new step joins the graph and the other steps are untouched', () => {
    const result = insertStepOnRoute(nodes, edges, 't_main', droppedNode)
    if (!result.ok) throw new Error('[internal] expected the splice to be accepted')
    expect(result.nodes).toHaveLength(3)
    expect(result.nodes.slice(0, 2)).toEqual(nodes)
    expect(result.edges).toHaveLength(2)
  })

  test('refuses an unknown route and a data-mapping link', () => {
    expect(insertStepOnRoute(nodes, edges, 'missing', droppedNode)).toEqual({ ok: false, code: 'unknownRoute' })
    const dataEdges: Edge[] = [
      { id: 'd_1', source: 'start_1', target: 'end_1', type: 'workflowDataMapping', data: {} },
    ]
    expect(insertStepOnRoute(nodes, dataEdges, 'd_1', droppedNode)).toEqual({ ok: false, code: 'dataMappingRoute' })
  })
})

describe('drag an action onto a route (spec section 4.4)', () => {
  const dropped = { activityId: 'activity_2', activityName: 'Call API', activityType: 'CALL_API', config: {} }

  test('appends after the activities the route already runs', () => {
    const result = appendActivityToRoute(edges, 't_main', dropped)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const data = result.edges[0].data as { activities: unknown[]; condition?: string }
    expect(data.activities).toHaveLength(2)
    expect(data.activities[1]).toEqual(dropped)
    expect(data.condition).toBe('amount > 100')
  })

  test('starts the list when the route runs nothing yet', () => {
    const bare: Edge[] = [{ id: 't_bare', source: 'start_1', target: 'end_1', data: { trigger: 'auto' } }]
    const result = appendActivityToRoute(bare, 't_bare', dropped)
    if (!result.ok) throw new Error('[internal] expected the append to be accepted')
    expect((result.edges[0].data as { activities: unknown[] }).activities).toEqual([dropped])
  })

  test('refuses an unknown route and a data-mapping link', () => {
    expect(appendActivityToRoute(edges, 'missing', dropped)).toEqual({ ok: false, code: 'unknownRoute' })
    const dataEdges: Edge[] = [
      { id: 'd_1', source: 'start_1', target: 'end_1', type: 'workflowDataMapping', data: {} },
    ]
    expect(appendActivityToRoute(dataEdges, 'd_1', dropped)).toEqual({ ok: false, code: 'dataMappingRoute' })
  })
})
