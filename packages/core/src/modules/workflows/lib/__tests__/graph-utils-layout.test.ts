import { definitionToGraph } from '../graph-utils'

type Step = { stepId: string; stepName: string; stepType: string }
type Transition = { transitionId: string; fromStepId: string; toStepId: string; trigger?: string }

function buildDefinition(steps: Step[], transitions: Transition[]): any {
  return { steps, transitions }
}

function step(stepId: string, stepType = 'AUTOMATED'): Step {
  return { stepId, stepName: stepId, stepType }
}

function transition(fromStepId: string, toStepId: string): Transition {
  return { transitionId: `${fromStepId}->${toStepId}`, fromStepId, toStepId, trigger: 'auto' }
}

const VERTICAL = 200
const startY = 50
const levelY = (level: number) => startY + level * VERTICAL

describe('calculateSmartLayout (via definitionToGraph autoLayout)', () => {
  test('two-node cycle terminates and positions every node', () => {
    const definition = buildDefinition(
      [step('start', 'START'), step('a'), step('b')],
      [transition('start', 'a'), transition('a', 'b'), transition('b', 'a')]
    )

    const { nodes } = definitionToGraph(definition)

    expect(nodes).toHaveLength(3)
    for (const node of nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true)
      expect(Number.isFinite(node.position.y)).toBe(true)
    }
  })

  test('self-loop terminates', () => {
    const definition = buildDefinition(
      [step('start', 'START'), step('loop')],
      [transition('start', 'loop'), transition('loop', 'loop')]
    )

    const { nodes } = definitionToGraph(definition)

    expect(nodes.map(n => n.id).sort()).toEqual(['loop', 'start'])
    for (const node of nodes) {
      expect(Number.isFinite(node.position.y)).toBe(true)
    }
  })

  test('renegotiation loop over many nodes stays bounded by node count', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `n${i}`)
    const steps = ids.map((id, i) => step(id, i === 0 ? 'START' : 'AUTOMATED'))
    const transitions = ids.map((id, i) => transition(id, ids[(i + 1) % ids.length]))

    const definition = buildDefinition(steps, transitions)
    const { nodes } = definitionToGraph(definition)

    expect(nodes).toHaveLength(ids.length)
    // The safety cap stops descending once level exceeds the node count, so no
    // node is laid out deeper than (nodeCount + 1) levels even though the graph
    // is a single cycle.
    const maxY = levelY(ids.length + 1)
    for (const node of nodes) {
      expect(node.position.y).toBeLessThanOrEqual(maxY)
    }
  })

  test('acyclic diamond keeps longest-path levels', () => {
    const definition = buildDefinition(
      [step('a', 'START'), step('b'), step('c'), step('d', 'END')],
      [transition('a', 'b'), transition('a', 'c'), transition('b', 'd'), transition('c', 'd')]
    )

    const { nodes } = definitionToGraph(definition)
    const yById = new Map(nodes.map(n => [n.id, n.position.y]))

    expect(yById.get('a')).toBe(levelY(0))
    expect(yById.get('b')).toBe(levelY(1))
    expect(yById.get('c')).toBe(levelY(1))
    // d is reachable at level 1 (a->...) but its longest path is 2, so it ranks below b/c.
    expect(yById.get('d')).toBe(levelY(2))
  })

  test('linear chain assigns one node per level', () => {
    const definition = buildDefinition(
      [step('a', 'START'), step('b'), step('c', 'END')],
      [transition('a', 'b'), transition('b', 'c')]
    )

    const { nodes } = definitionToGraph(definition)
    const yById = new Map(nodes.map(n => [n.id, n.position.y]))

    expect(yById.get('a')).toBe(levelY(0))
    expect(yById.get('b')).toBe(levelY(1))
    expect(yById.get('c')).toBe(levelY(2))
  })
})
