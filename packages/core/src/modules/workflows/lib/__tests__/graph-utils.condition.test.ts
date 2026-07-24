import { describe, expect, test } from '@jest/globals'
import { definitionToGraph, graphToDefinition } from '../graph-utils'

describe('workflow graph inline conditions', () => {
  test('preserves inline conditions through definition and graph conversion', () => {
    const condition = {
      operator: 'AND',
      rules: [
        { field: 'invoice.total', operator: '>=', value: 1000 },
        { field: 'invoice.currency', operator: '=', value: 'EUR' },
      ],
    }
    const definition = {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        {
          transitionId: 'to-end',
          fromStepId: 'start',
          toStepId: 'end',
          trigger: 'auto',
          condition,
        },
      ],
    }

    const graph = definitionToGraph(definition)
    expect(graph.edges[0].data?.condition).toEqual(condition)

    const roundTripped = graphToDefinition(graph.nodes, graph.edges)
    expect(roundTripped.transitions[0].condition).toEqual(condition)
  })
})
