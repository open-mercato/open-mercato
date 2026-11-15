/** @jest-environment node */

/**
 * "Show last run" on the Studio canvas (spec §8.3).
 *
 * The overlay is applied at RENDER time in `WorkflowGraphImpl` — the same rule
 * the compensation ghosts and the outcome-row footers follow — so it can never
 * reach the document, the undo stack, an autosave or `graphToDefinition`. This
 * file pins the two halves that make that true: the derivation is pure, and the
 * document produced from an overlaid graph is byte-identical to the one
 * produced without it.
 */

import { describe, test, expect } from '@jest/globals'
import { deriveRunExecution, isRouteTaken, resolveNodeRunStatus } from '../run-execution'
import { definitionToGraph, graphToDefinition } from '../graph-utils'

const DEFINITION = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'charge', stepName: 'Charge', stepType: 'AUTOMATED' },
    { stepId: 'refund', stepName: 'Refund', stepType: 'AUTOMATED' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 't_1', fromStepId: 'start', toStepId: 'charge', trigger: 'auto' },
    { transitionId: 't_2', fromStepId: 'charge', toStepId: 'end', trigger: 'auto' },
    { transitionId: 't_3', fromStepId: 'charge', toStepId: 'refund', trigger: 'auto' },
  ],
}

const EXECUTION = deriveRunExecution({
  events: [
    {
      eventType: 'TRANSITION_EXECUTED',
      eventData: { fromStepId: 'start', toStepId: 'charge', transitionId: 't_1' },
      occurredAt: '2026-07-29T10:00:00.000Z',
    },
    {
      eventType: 'TRANSITION_EXECUTED',
      eventData: { fromStepId: 'charge', toStepId: 'refund', transitionId: 't_3' },
      occurredAt: '2026-07-29T10:00:05.000Z',
    },
  ],
  stepInstances: [
    { stepId: 'charge', status: 'FAILED', enteredAt: '2026-07-29T10:00:01.000Z', exitedAt: '2026-07-29T10:00:04.000Z' },
    { stepId: 'refund', status: 'COMPLETED', enteredAt: '2026-07-29T10:00:05.000Z', exitedAt: '2026-07-29T10:00:06.000Z' },
  ],
  currentStepId: 'refund',
  instanceStatus: 'COMPLETED',
})

/** The exact decoration `WorkflowGraphImpl` applies at render time. */
function applyOverlay(nodes: ReturnType<typeof definitionToGraph>['nodes'], edges: ReturnType<typeof definitionToGraph>['edges']) {
  const overlaidNodes = nodes.map((node) => {
    const status = resolveNodeRunStatus(EXECUTION, { id: node.id, type: node.type })
    if (status === 'pending') return node
    return { ...node, data: { ...node.data, status } }
  })
  const overlaidEdges = edges.map((edge) =>
    isRouteTaken(EXECUTION, { transitionId: edge.id, fromStepId: edge.source, toStepId: edge.target })
      ? { ...edge, data: { ...edge.data, state: 'completed' } }
      : edge
  )
  return { overlaidNodes, overlaidEdges }
}

describe('last-run overlay on the Studio canvas', () => {
  test('paints which steps ran and how they ended', () => {
    const { nodes } = definitionToGraph(DEFINITION as never, { autoLayout: false })
    const { overlaidNodes } = applyOverlay(nodes, [])
    const statusOf = (id: string) => overlaidNodes.find((node) => node.id === id)?.data.status

    expect(statusOf('charge')).toBe('failed')
    expect(statusOf('refund')).toBe('completed')
    expect(statusOf('start')).toBe('completed')
    expect(statusOf('end')).toBe('completed')
  })

  test('leaves an un-run step in the editor look rather than repainting it', () => {
    const execution = deriveRunExecution({ stepInstances: [] })
    const { nodes } = definitionToGraph(DEFINITION as never, { autoLayout: false })
    const charge = nodes.find((node) => node.id === 'charge')!
    expect(resolveNodeRunStatus(execution, { id: charge.id, type: charge.type })).toBe('pending')
  })

  test('marks the routes the run actually took, and only those', () => {
    const { edges } = definitionToGraph(DEFINITION as never, { autoLayout: false })
    const { overlaidEdges } = applyOverlay([], edges)
    const stateOf = (id: string) => (overlaidEdges.find((edge) => edge.id === id)?.data as { state?: string })?.state

    expect(stateOf('t_1')).toBe('completed')
    expect(stateOf('t_3')).toBe('completed')
    // The branch the run did not take stays neutral.
    expect(stateOf('t_2')).toBe('pending')
  })

  test('the overlay never reaches the saved definition', () => {
    const { nodes, edges } = definitionToGraph(DEFINITION as never, { autoLayout: false })
    const { overlaidNodes, overlaidEdges } = applyOverlay(nodes, edges)

    const plain = graphToDefinition(nodes, edges)
    const overlaid = graphToDefinition(overlaidNodes, overlaidEdges)

    expect(JSON.stringify(overlaid)).toBe(JSON.stringify(plain))
  })

  test('the overlay never mutates the graph it decorates', () => {
    const { nodes, edges } = definitionToGraph(DEFINITION as never, { autoLayout: false })
    const nodesBefore = JSON.stringify(nodes)
    const edgesBefore = JSON.stringify(edges)

    applyOverlay(nodes, edges)

    expect(JSON.stringify(nodes)).toBe(nodesBefore)
    expect(JSON.stringify(edges)).toBe(edgesBefore)
  })
})
