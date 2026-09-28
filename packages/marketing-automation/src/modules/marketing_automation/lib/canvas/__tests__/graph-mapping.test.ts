import { AUDIENCE_NODE_ID, autoArrange, definitionToGraph, readCanvasFromGraph, triggerNodeId } from '../graph-mapping'
import type { CampaignDefinition, CampaignStep } from '../../engine/types'
import type { CampaignTriggerInput } from '../../../data/validators'

const step = (id: string, type = 'send_email'): CampaignStep => ({ id, type, params: {} })
const onOrder: CampaignTriggerInput = { kind: 'event', eventId: 'sales.order.created' }
const onSignup: CampaignTriggerInput = { kind: 'event', eventId: 'customers.person.created' }
const nightly: CampaignTriggerInput = { kind: 'schedule', scheduleValue: '1d', reentryAfterDays: 30 }

const definition = (over: Partial<CampaignDefinition> = {}): CampaignDefinition => ({
  version: 1,
  audience: null,
  steps: [],
  ...over,
})

describe('definitionToGraph — nodes', () => {
  test('the audience node is always present, even with nothing else authored', () => {
    const { nodes, edges } = definitionToGraph(definition(), [])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ id: AUDIENCE_NODE_ID, type: 'audience' })
    expect(edges).toEqual([])
  })

  // "No audience" and "not configured" are indistinguishable in storage, so the node carries
  // the flag that lets the UI say "fires for everyone" out loud.
  test('a missing audience is flagged as everyone', () => {
    const [audience] = definitionToGraph(definition({ audience: null }), []).nodes
    expect(audience.data).toEqual({ audience: null, isEveryone: true })
  })

  test('a present audience is not flagged as everyone', () => {
    const expression = { field: 'orders.count', operator: '>=' as const, value: 1 }
    const [audience] = definitionToGraph(definition({ audience: expression }), []).nodes
    expect(audience.data).toEqual({ audience: expression, isEveryone: false })
  })

  test('every trigger becomes a node', () => {
    const { nodes } = definitionToGraph(definition(), [onOrder, onSignup, nightly])
    expect(nodes.filter((n) => n.type === 'trigger').map((n) => n.id)).toEqual([
      'trigger:event:sales.order.created',
      'trigger:event:customers.person.created',
      'trigger:schedule:1d',
    ])
  })

  test('every step becomes a node carrying its index', () => {
    const { nodes } = definitionToGraph(definition({ steps: [step('s1'), step('s2', 'wait')] }), [])
    expect(nodes.filter((n) => n.type === 'step').map((n) => [n.id, (n.data as { index: number }).index]))
      .toEqual([['s1', 0], ['s2', 1]])
  })
})

describe('definitionToGraph — derived edges', () => {
  test('all triggers converge on the audience', () => {
    const { edges } = definitionToGraph(definition(), [onOrder, onSignup])
    expect(edges).toEqual([
      { id: 'edge:trigger:event:sales.order.created->audience', source: 'trigger:event:sales.order.created', target: AUDIENCE_NODE_ID },
      { id: 'edge:trigger:event:customers.person.created->audience', source: 'trigger:event:customers.person.created', target: AUDIENCE_NODE_ID },
    ])
  })

  test('the steps form one chain starting at the audience', () => {
    const { edges } = definitionToGraph(definition({ steps: [step('s1'), step('s2'), step('s3')] }), [])
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      [AUDIENCE_NODE_ID, 's1'],
      ['s1', 's2'],
      ['s2', 's3'],
    ])
  })

  test('a wait step is an ordinary node in the chain, not a synthesized one', () => {
    const steps = [step('s1'), step('w1', 'wait'), step('s2')]
    const { nodes, edges } = definitionToGraph(definition({ steps }), [])
    expect(nodes.filter((n) => n.type === 'step')).toHaveLength(3)
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      [AUDIENCE_NODE_ID, 's1'],
      ['s1', 'w1'],
      ['w1', 's2'],
    ])
  })
})

describe('layout round trip', () => {
  test('saved positions are used instead of the defaults', () => {
    const canvas = { nodePositions: { audience: { x: 11, y: 22 }, s1: { x: 33, y: 44 } } }
    const { nodes } = definitionToGraph(definition({ steps: [step('s1')], canvas }), [])
    expect(nodes.find((n) => n.id === AUDIENCE_NODE_ID)!.position).toEqual({ x: 11, y: 22 })
    expect(nodes.find((n) => n.id === 's1')!.position).toEqual({ x: 33, y: 44 })
  })

  test('positions survive a graph round trip unchanged', () => {
    const canvas = {
      viewport: { x: 5, y: 6, zoom: 1.25 },
      nodePositions: {
        'trigger:event:sales.order.created': { x: -40, y: 10 },
        audience: { x: 300, y: 80 },
        s1: { x: 700, y: 120 },
      },
    }
    const input = definition({ steps: [step('s1')], canvas })
    const { nodes } = definitionToGraph(input, [onOrder])
    expect(readCanvasFromGraph(nodes, canvas.viewport)).toEqual(canvas)
  })

  test('a position for a node that no longer exists is dropped rather than accumulating', () => {
    const canvas = { nodePositions: { audience: { x: 1, y: 2 }, deletedStep: { x: 9, y: 9 } } }
    const { nodes } = definitionToGraph(definition({ canvas }), [])
    expect(readCanvasFromGraph(nodes).nodePositions).toEqual({ audience: { x: 1, y: 2 } })
  })
})

describe('autoArrange', () => {
  test('discards manual positions but keeps the viewport', () => {
    const canvas = { viewport: { x: 1, y: 2, zoom: 2 }, nodePositions: { audience: { x: 999, y: 999 } } }
    const arranged = autoArrange(definition({ steps: [step('s1'), step('s2')], canvas }), [onOrder])
    expect(arranged.viewport).toEqual(canvas.viewport)
    expect(arranged.nodePositions!.audience).not.toEqual({ x: 999, y: 999 })
    expect(arranged.nodePositions!.s1.y).toBeLessThan(arranged.nodePositions!.s2.y)
  })
})

describe('triggerNodeId', () => {
  test('is derived from the trigger content so layout survives a save', () => {
    expect(triggerNodeId(onOrder)).toBe('trigger:event:sales.order.created')
    expect(triggerNodeId(nightly)).toBe('trigger:schedule:1d')
    expect(triggerNodeId({ ...onOrder })).toBe(triggerNodeId(onOrder))
  })
})

describe('definitionToGraph — splits', () => {
  const splitDefinition = (): CampaignDefinition => ({
    version: 1,
    audience: null,
    steps: [
      { id: 'before', type: 'add_tag', params: {} },
      {
        id: 'split-1',
        type: 'split',
        params: {
          variants: [
            { key: 'a', weight: 3, steps: [{ id: 'a-1', type: 'send_email', params: {} }] },
            { key: 'b', weight: 1, steps: [{ id: 'b-1', type: 'send_email', params: {} }] },
          ],
        },
      },
      { id: 'after', type: 'add_tag', params: {} },
    ],
  })

  test('renders a split node carrying each lane share', () => {
    const { nodes } = definitionToGraph(splitDefinition(), [])
    const split = nodes.find((node) => node.id === 'split-1')
    expect(split?.type).toBe('split')
    expect(split?.type === 'split' ? split.data.variants : []).toEqual([
      { key: 'a', weight: 3, share: 0.75, stepCount: 1 },
      { key: 'b', weight: 1, share: 0.25, stepCount: 1 },
    ])
  })

  test('renders lane steps and tells each one which lane it belongs to', () => {
    const { nodes } = definitionToGraph(splitDefinition(), [])
    const laneStep = nodes.find((node) => node.id === 'b-1')
    expect(laneStep?.type === 'step' ? laneStep.data.lane : null).toEqual({ splitId: 'split-1', laneKey: 'b' })
  })

  // The picture has to say what the engine does: a split fans out and REJOINS, because
  // `flattenSteps` puts the chosen lane in place and carries on with the rest of the chain.
  test('lanes fan out from the split and rejoin at the next step', () => {
    const { edges } = definitionToGraph(splitDefinition(), [])
    const pairs = edges.map((edge) => `${edge.source}->${edge.target}`)
    expect(pairs).toContain('before->split-1')
    expect(pairs).toContain('split-1->a-1')
    expect(pairs).toContain('split-1->b-1')
    expect(pairs).toContain('a-1->after')
    expect(pairs).toContain('b-1->after')
    expect(pairs).not.toContain('split-1->after')
  })

  test('an empty lane passes straight through so nothing downstream is stranded', () => {
    const definition: CampaignDefinition = {
      version: 1,
      audience: null,
      steps: [
        { id: 'split-1', type: 'split', params: { variants: [
          { key: 'a', weight: 1, steps: [{ id: 'a-1', type: 'send_email', params: {} }] },
          { key: 'b', weight: 1, steps: [] },
        ] } },
        { id: 'after', type: 'add_tag', params: {} },
      ],
    }
    const pairs = definitionToGraph(definition, []).edges.map((edge) => `${edge.source}->${edge.target}`)
    expect(pairs).toContain('a-1->after')
    expect(pairs).toContain('split-1->after')
  })

  test('lanes are laid out on rows of their own so nodes never overlap', () => {
    const { nodes } = definitionToGraph(splitDefinition(), [])
    const positions = nodes.map((node) => `${node.position.x}:${node.position.y}`)
    expect(new Set(positions).size).toBe(positions.length)
  })

  test('a saved position still wins for a lane step', () => {
    const definition = splitDefinition()
    definition.canvas = { nodePositions: { 'b-1': { x: 11, y: 22 } } }
    const { nodes } = definitionToGraph(definition, [])
    expect(nodes.find((node) => node.id === 'b-1')?.position).toEqual({ x: 11, y: 22 })
  })

  test('every edge id is unique, which React Flow requires', () => {
    const { edges } = definitionToGraph(splitDefinition(), [
      { kind: 'event', eventId: 'customers.person.created' },
    ])
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length)
  })
})

describe('definitionToGraph — more than two lanes', () => {
  test('each lane gets a column of its own, so three or more never overlap', () => {
    const definition: CampaignDefinition = {
      version: 1,
      audience: null,
      steps: [
        { id: 'sp', type: 'split', params: { variants: [
          { key: 'a', weight: 1, steps: [{ id: 'a1', type: 'send_email', params: {} }] },
          { key: 'b', weight: 1, steps: [{ id: 'b1', type: 'send_email', params: {} }] },
          { key: 'c', weight: 1, steps: [{ id: 'c1', type: 'send_email', params: {} }] },
        ] } },
        { id: 'after', type: 'add_tag', params: {} },
      ],
    }
    const { nodes, edges } = definitionToGraph(definition, [])
    const laneXs = ['a1', 'b1', 'c1'].map((id) => nodes.find((node) => node.id === id)!.position.x)
    expect(new Set(laneXs).size).toBe(3)
    const pairs = edges.map((edge) => `${edge.source}->${edge.target}`)
    for (const laneStep of ['a1', 'b1', 'c1']) {
      expect(pairs).toContain(`sp->${laneStep}`)
      expect(pairs).toContain(`${laneStep}->after`)
    }
  })
})
