/**
 * Caller graph — breaking-change diff (Phase 5).
 */

import { describe, test, expect } from '@jest/globals'
import { computeCallerImpacts } from '../caller-graph'
import type { WorkflowIoContract } from '../../data/validators'

const callerWith = (config: Record<string, any>) => ({
  workflowId: 'order-flow',
  version: 1,
  definition: {
    steps: [
      { stepId: 'start', stepType: 'START' },
      { stepId: 'sub', stepType: 'SUB_WORKFLOW', config: { subWorkflowId: 'verify_policy', ...config } },
      { stepId: 'end', stepType: 'END' },
    ],
  },
})

const ports: WorkflowIoContract = {
  inputs: [{ name: 'claimId', type: 'text', label: 'Claim', required: true }],
  outputs: [{ name: 'decision', type: 'text', label: 'Decision', required: false }],
}

describe('computeCallerImpacts', () => {
  test('flags input mappings that reference a removed input port', () => {
    const callers = [callerWith({ inputMapping: { claimId: 'order.id', amount: 'order.total' } })]
    const impacts = computeCallerImpacts(callers, 'verify_policy', ports)
    expect(impacts).toHaveLength(1)
    expect(impacts[0].brokenMappings).toEqual(['input:amount'])
    expect(impacts[0].stepId).toBe('sub')
  })

  test('flags output mappings whose first path segment is not an output port', () => {
    const callers = [callerWith({ outputMapping: { result: 'decision', extra: 'reason.code' } })]
    const impacts = computeCallerImpacts(callers, 'verify_policy', ports)
    expect(impacts[0].brokenMappings).toEqual(['output:reason.code'])
  })

  test('returns no impact when all mappings match declared ports', () => {
    const callers = [callerWith({ inputMapping: { claimId: 'order.id' }, outputMapping: { result: 'decision' } })]
    expect(computeCallerImpacts(callers, 'verify_policy', ports)).toEqual([])
  })

  test('ignores callers that reference a different sub-workflow', () => {
    const other = {
      workflowId: 'x',
      version: 1,
      definition: { steps: [{ stepId: 'sub', stepType: 'SUB_WORKFLOW', config: { subWorkflowId: 'other', inputMapping: { nope: 'a' } } }] },
    }
    expect(computeCallerImpacts([other], 'verify_policy', ports)).toEqual([])
  })
})
