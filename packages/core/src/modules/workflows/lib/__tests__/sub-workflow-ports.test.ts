/**
 * Sub-workflow port rendering — definitionToGraph populates SUB_WORKFLOW node
 * IN/OUT ports from the supplied child contracts (Phase 3).
 */

import { describe, test, expect } from '@jest/globals'
import { definitionToGraph } from '../graph-utils'
import type { WorkflowIoContract } from '../../data/validators'

const definition = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'sub', stepName: 'Verify Policy', stepType: 'SUB_WORKFLOW', config: { subWorkflowId: 'verify_policy' } },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 'start-sub', fromStepId: 'start', toStepId: 'sub', trigger: 'auto' },
    { transitionId: 'sub-end', fromStepId: 'sub', toStepId: 'end', trigger: 'auto' },
  ],
} as any

const contract: WorkflowIoContract = {
  inputs: [{ name: 'claimId', type: 'text', label: 'Claim', required: true }],
  outputs: [{ name: 'decision', type: 'select', label: 'Decision', required: false, options: ['approve', 'reject'] }],
}

describe('definitionToGraph — sub-workflow ports', () => {
  test('populates IN/OUT ports on the SUB_WORKFLOW node from child contracts', () => {
    const childContracts = new Map<string, WorkflowIoContract>([['verify_policy', contract]])
    const { nodes } = definitionToGraph(definition, { childContracts })
    const subNode = nodes.find((node) => node.id === 'sub')

    expect(subNode?.type).toBe('subWorkflow')
    expect((subNode!.data as any).inputs).toEqual(contract.inputs)
    expect((subNode!.data as any).outputs).toEqual(contract.outputs)
  })

  test('renders no ports when no child contract is supplied (backward compatible)', () => {
    const { nodes } = definitionToGraph(definition)
    const subNode = nodes.find((node) => node.id === 'sub')

    expect((subNode!.data as any).inputs).toBeUndefined()
    expect((subNode!.data as any).outputs).toBeUndefined()
  })
})
