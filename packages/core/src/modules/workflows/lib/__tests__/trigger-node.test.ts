/** @jest-environment node */

/**
 * The canvas trigger node (fidelity gap #5).
 *
 * Three things are load-bearing and are pinned here:
 *
 *  - it is a RENDER-TIME overlay and NEVER part of the document — a definition
 *    declaring triggers has to serialize byte-identically to one that does not,
 *    the same guarantee `lib/__tests__/editor-annotations` and
 *    `lib/__tests__/last-run-overlay` make for their own overlays;
 *  - it is not a step — `validateWorkflowGraph` must not count it toward the
 *    exactly-one-START / at-least-one-END invariants, and `applyAutoLayout` must
 *    not rank it;
 *  - what it SAYS is true of the running system: a definition with no triggers
 *    is still startable (manual / API), a disabled trigger cannot fire, and a
 *    disabled definition cannot be started at all.
 */

import { describe, test, expect } from '@jest/globals'
import {
  buildTriggerEdge,
  buildTriggerNode,
  buildTriggerNodeModel,
  isTriggerEdge,
  isTriggerNode,
  startNodeBox,
  triggerNodeBox,
  triggerNodeFootprint,
  triggerNodeRowCount,
  TRIGGER_EDGE_DASH_ARRAY,
  TRIGGER_NODE_EVENT_LIMIT,
  WORKFLOW_TRIGGER_NODE_ID,
  WORKFLOW_TRIGGER_NODE_TYPE,
} from '../trigger-node'
import {
  applyAutoLayout,
  definitionToGraph,
  graphToDefinition,
  validateWorkflowGraph,
} from '../graph-utils'
import { TRIGGER_NODE_GAP } from '../node-geometry'

const DEFINITION = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'charge', stepName: 'Charge', stepType: 'AUTOMATED' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 't_1', fromStepId: 'start', toStepId: 'charge', trigger: 'auto' },
    { transitionId: 't_2', fromStepId: 'charge', toStepId: 'end', trigger: 'auto' },
  ],
}

const TRIGGERS = [
  { triggerId: 'deal_created', name: 'Deal created', eventPattern: 'customers.deal.created', enabled: true },
  { triggerId: 'deal_updated', name: 'Deal updated', eventPattern: 'customers.deal.updated', enabled: true },
]

function anchor(overrides: Partial<{ x: number; y: number; width: number; height: number }> = {}) {
  const { x = 0, y = 100, width = 120, height = 36 } = overrides
  return { id: 'start', position: { x, y }, measured: { width, height } }
}

describe('what the trigger node says is true of the running system', () => {
  test('a definition with NO triggers still renders — manual and API starts always exist', () => {
    const model = buildTriggerNodeModel([])

    expect(model.rows).toEqual([])
    expect(model.triggerCount).toBe(0)
    expect(model.definitionEnabled).toBe(true)
    // The manual/API line is the one unconditional row: `startWorkflow` needs no
    // trigger, so an empty node would be the misleading rendering, not this one.
    expect(triggerNodeRowCount(model)).toBe(1)
  })

  test('a disabled definition drops every entry point, because it has none', () => {
    const model = buildTriggerNodeModel(TRIGGERS, { definitionEnabled: false })

    expect(model.definitionEnabled).toBe(false)
    // `startWorkflow` throws DEFINITION_DISABLED before it looks at a trigger,
    // so listing the triggers as live routes in would be false.
    expect(triggerNodeRowCount(model)).toBe(1)
  })

  test('a disabled trigger is marked, never silently dropped', () => {
    const model = buildTriggerNodeModel([
      { triggerId: 'off', name: 'Off', eventPattern: 'a.b.c', enabled: false },
    ])

    expect(model.rows).toHaveLength(1)
    expect(model.rows[0]?.enabled).toBe(false)
    expect(model.enabledCount).toBe(0)
  })

  test('a trigger with no event pattern is not an entry point and is not listed', () => {
    const model = buildTriggerNodeModel([{ triggerId: 'blank', name: 'Blank', eventPattern: '   ' }])
    expect(model.triggerCount).toBe(0)
  })
})

describe('many triggers stay readable at 60-node density', () => {
  const many = Array.from({ length: 7 }, (_, index) => ({
    triggerId: `t${index}`,
    name: `Trigger ${index}`,
    eventPattern: `module.entity.event${index}`,
    enabled: true,
  }))

  test('one node lists them, capped, with the remainder counted', () => {
    const model = buildTriggerNodeModel(many)

    expect(model.rows).toHaveLength(TRIGGER_NODE_EVENT_LIMIT)
    expect(model.hiddenCount).toBe(many.length - TRIGGER_NODE_EVENT_LIMIT)
    expect(model.triggerCount).toBe(many.length)
  })

  test('a disabled trigger never displaces a live one into the overflow', () => {
    const model = buildTriggerNodeModel([
      { triggerId: 'off1', eventPattern: 'x.1', enabled: false },
      { triggerId: 'off2', eventPattern: 'x.2', enabled: false },
      { triggerId: 'off3', eventPattern: 'x.3', enabled: false },
      { triggerId: 'live', eventPattern: 'x.live', enabled: true },
    ])

    expect(model.rows.map((row) => row.eventPattern)).toContain('x.live')
    expect(model.rows[0]?.eventPattern).toBe('x.live')
  })

  test('the node grows with what it shows, so the canvas can reserve it', () => {
    const one = triggerNodeFootprint(buildTriggerNodeModel([TRIGGERS[0]]))
    const capped = triggerNodeFootprint(buildTriggerNodeModel(many))

    expect(capped.height).toBeGreaterThan(one.height)
    expect(capped.width).toBe(one.width)
  })
})

describe('layout: the pill sits before START and is never ranked', () => {
  test('its box clears the START terminal entirely, on the left', () => {
    const model = buildTriggerNodeModel(TRIGGERS)
    const start = anchor()
    const box = triggerNodeBox(model, start)
    const startBox = startNodeBox(start)

    expect(box.x + box.width).toBe(startBox.x - TRIGGER_NODE_GAP)
    expect(box.x + box.width).toBeLessThanOrEqual(startBox.x)
    // Centred on START, so the connector leaves level with the terminal.
    expect(box.y + box.height / 2).toBe(startBox.y + startBox.height / 2)
  })

  test('a taller pill still clears START rather than growing into it', () => {
    const tall = buildTriggerNodeModel(
      Array.from({ length: 9 }, (_, index) => ({ triggerId: `t${index}`, eventPattern: `a.b.${index}`, enabled: true })),
    )
    const start = anchor()
    const box = triggerNodeBox(tall, start)
    expect(box.x + box.width).toBeLessThanOrEqual(startNodeBox(start).x)
  })

  test('it falls back to the terminal footprint when React Flow has not measured yet', () => {
    const model = buildTriggerNodeModel(TRIGGERS)
    const unmeasured = { id: 'start', position: { x: 0, y: 100 } }
    expect(triggerNodeBox(model, unmeasured).x).toBeLessThan(0)
  })

  test('Tidy never ranks it — every other node keeps the arrangement it would have had', () => {
    const { nodes, edges } = definitionToGraph(DEFINITION as never, { autoLayout: false })
    const trigger = buildTriggerNode(buildTriggerNodeModel(TRIGGERS), anchor())

    const withoutTrigger = applyAutoLayout(nodes, edges)
    const withTrigger = applyAutoLayout([...nodes, trigger], [...edges, buildTriggerEdge('start')])

    for (const node of withoutTrigger) {
      const paired = withTrigger.find((candidate) => candidate.id === node.id)
      expect(paired?.position).toEqual(node.position)
    }
    // And the pill itself is returned untouched, still anchored to START.
    const laidOutTrigger = withTrigger.find((node) => node.id === WORKFLOW_TRIGGER_NODE_ID)
    expect(laidOutTrigger?.position).toEqual(trigger.position)
  })
})

describe('the pill is not a step', () => {
  test('validateWorkflowGraph does not count it as a START, an END or an orphan', () => {
    const { nodes, edges } = definitionToGraph(DEFINITION as never, { autoLayout: false })
    const trigger = buildTriggerNode(buildTriggerNodeModel(TRIGGERS), anchor())

    const plain = validateWorkflowGraph(nodes, edges)
    const withTrigger = validateWorkflowGraph([...nodes, trigger], [...edges, buildTriggerEdge('start')])

    expect(withTrigger).toEqual(plain)
    expect(withTrigger.some((issue) => issue.message.includes('multiple START'))).toBe(false)
  })

  test('no editing gesture can reach it: not draggable, selectable, deletable or connectable', () => {
    const trigger = buildTriggerNode(buildTriggerNodeModel(TRIGGERS), anchor())

    expect(trigger.type).toBe(WORKFLOW_TRIGGER_NODE_TYPE)
    expect(trigger.draggable).toBe(false)
    expect(trigger.selectable).toBe(false)
    expect(trigger.deletable).toBe(false)
    expect(trigger.connectable).toBe(false)
    expect(trigger.focusable).toBe(false)
  })

  test('its connector is inert and carries its own dash pattern, not a route style', () => {
    const edge = buildTriggerEdge('start')

    expect(edge.source).toBe(WORKFLOW_TRIGGER_NODE_ID)
    expect(edge.target).toBe('start')
    expect(edge.type).not.toBe('workflowTransition')
    expect(edge.selectable).toBe(false)
    expect(edge.deletable).toBe(false)
    expect(edge.reconnectable).toBe(false)
    expect((edge.style as Record<string, unknown>)?.strokeDasharray).toBe(TRIGGER_EDGE_DASH_ARRAY)
    // Distinct from every other dash the canvas already spends.
    expect(['8,4', '2,3', '10,4,2,4']).not.toContain(TRIGGER_EDGE_DASH_ARRAY)
  })

  test('it is recognisable by id alone, so a filter cannot be defeated by a missing type', () => {
    expect(isTriggerNode({ id: WORKFLOW_TRIGGER_NODE_ID })).toBe(true)
    expect(isTriggerNode({ id: 'start', type: 'start' })).toBe(false)
    expect(isTriggerEdge(buildTriggerEdge('start'))).toBe(true)
    expect(isTriggerEdge({ id: 't_1', source: 'start', target: 'charge' })).toBe(false)
  })
})

describe('the pill never enters the document', () => {
  test('a definition with triggers serializes byte-identically to one without the node', () => {
    const { nodes, edges } = definitionToGraph(DEFINITION as never, { autoLayout: false })
    const trigger = buildTriggerNode(buildTriggerNodeModel(TRIGGERS), anchor())

    const plain = graphToDefinition(nodes, edges)
    const withTrigger = graphToDefinition([...nodes, trigger], [...edges, buildTriggerEdge('start')])

    expect(JSON.stringify(withTrigger)).toBe(JSON.stringify(plain))
  })

  test('the same holds with positions included — no `_editorPosition` is invented for it', () => {
    const { nodes, edges } = definitionToGraph(DEFINITION as never, { autoLayout: false })
    const trigger = buildTriggerNode(buildTriggerNodeModel(TRIGGERS), anchor())

    const plain = graphToDefinition(nodes, edges, { includePositions: true })
    const withTrigger = graphToDefinition([...nodes, trigger], [...edges, buildTriggerEdge('start')], {
      includePositions: true,
    })

    expect(JSON.stringify(withTrigger)).toBe(JSON.stringify(plain))
    expect(JSON.stringify(withTrigger)).not.toContain(WORKFLOW_TRIGGER_NODE_ID)
  })

  test('building it mutates neither the graph it decorates nor the triggers it reads', () => {
    const { nodes, edges } = definitionToGraph(DEFINITION as never, { autoLayout: false })
    const nodesBefore = JSON.stringify(nodes)
    const edgesBefore = JSON.stringify(edges)
    const triggersBefore = JSON.stringify(TRIGGERS)

    buildTriggerNode(buildTriggerNodeModel(TRIGGERS), anchor())

    expect(JSON.stringify(nodes)).toBe(nodesBefore)
    expect(JSON.stringify(edges)).toBe(edgesBefore)
    expect(JSON.stringify(TRIGGERS)).toBe(triggersBefore)
  })
})
