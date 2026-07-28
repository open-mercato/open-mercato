import { describe, test, expect } from '@jest/globals'
import { definitionToGraph, graphToDefinition } from '../graph-utils'
import { stepTypeToNodeType } from '../node-type-icons'

const branchingDefinition = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'amount-check', stepName: 'Amount Check', stepType: 'IF_ELSE' },
    { stepId: 'channel', stepName: 'Channel', stepType: 'SWITCH' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 'e_start_amount-check', fromStepId: 'start', toStepId: 'amount-check', trigger: 'auto' },
    {
      transitionId: 'e_amount-check_channel',
      fromStepId: 'amount-check',
      toStepId: 'channel',
      trigger: 'auto',
      priority: 10,
      condition: { field: 'total', operator: '>', value: 100 },
    },
    { transitionId: 'e_amount-check_end', fromStepId: 'amount-check', toStepId: 'end', trigger: 'auto', priority: 0 },
    { transitionId: 'e_channel_end', fromStepId: 'channel', toStepId: 'end', trigger: 'auto', priority: 0 },
  ],
} as any

describe('graph-utils branching steps', () => {
  test('maps IF_ELSE and SWITCH steps to their node types', () => {
    const { nodes } = definitionToGraph(branchingDefinition)
    const byId = new Map(nodes.map((node) => [node.id, node]))

    expect(byId.get('amount-check')?.type).toBe('ifElse')
    expect(byId.get('channel')?.type).toBe('switch')
    expect(stepTypeToNodeType('IF_ELSE')).toBe('ifElse')
    expect(stepTypeToNodeType('SWITCH')).toBe('switch')
  })

  test('round-trips branching steps back to their step types', () => {
    const { nodes, edges } = definitionToGraph(branchingDefinition)
    const roundTripped = graphToDefinition(nodes, edges)

    expect(roundTripped.steps.map((step: any) => [step.stepId, step.stepType])).toEqual([
      ['start', 'START'],
      ['amount-check', 'IF_ELSE'],
      ['channel', 'SWITCH'],
      ['end', 'END'],
    ])
  })

  test('stores branching routes as plain prioritized transitions', () => {
    const { nodes, edges } = definitionToGraph(branchingDefinition)
    const roundTripped = graphToDefinition(nodes, edges)
    const branchRoutes = roundTripped.transitions.filter((transition: any) => transition.fromStepId === 'amount-check')

    expect(branchRoutes).toHaveLength(2)
    expect(branchRoutes.map((transition: any) => transition.priority)).toEqual([10, 0])
    expect(branchRoutes[0].condition).toEqual({ field: 'total', operator: '>', value: 100 })
    expect(branchRoutes[1].condition).toBeUndefined()
    for (const transition of branchRoutes) {
      expect(Object.keys(transition).some((key) => key.startsWith('branch'))).toBe(false)
    }
  })
})
