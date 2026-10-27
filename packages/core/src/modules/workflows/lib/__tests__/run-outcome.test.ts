/**
 * The run verdict (`WorkflowInstance.outcome`) and the invariant it exists for.
 */

import { describe, test, expect } from '@jest/globals'
import {
  WORKFLOW_RUN_OUTCOMES,
  isDegradedRunOutcome,
  isRetryableRunOutcome,
  isWorkflowRunOutcome,
  resolveRunOutcome,
  type RunOutcomeEvidence,
} from '../run-outcome'

const evidence = (over: Partial<RunOutcomeEvidence> = {}): RunOutcomeEvidence => ({
  terminalStatus: 'COMPLETED',
  failureEvidenceCount: 0,
  warningEvidenceCount: 0,
  ...over,
})

describe('resolveRunOutcome', () => {
  test('a clean run that reached END is success', () => {
    expect(resolveRunOutcome(evidence())).toBe('success')
  })

  test('a run that reached END carrying a tolerated failure is partial_failure', () => {
    expect(resolveRunOutcome(evidence({ failureEvidenceCount: 3 }))).toBe('partial_failure')
  })

  test('a run that reached END with only warnings is success_with_warnings', () => {
    expect(resolveRunOutcome(evidence({ warningEvidenceCount: 1 }))).toBe('success_with_warnings')
  })

  test('failure evidence outranks warning evidence', () => {
    expect(
      resolveRunOutcome(evidence({ failureEvidenceCount: 1, warningEvidenceCount: 9 })),
    ).toBe('partial_failure')
  })

  test('a run that never reached END is failure', () => {
    expect(resolveRunOutcome(evidence({ terminalStatus: 'FAILED' }))).toBe('failure')
  })

  test('a cancelled run is cancelled, a compensated run is compensated', () => {
    expect(resolveRunOutcome(evidence({ terminalStatus: 'CANCELLED' }))).toBe('cancelled')
    expect(resolveRunOutcome(evidence({ terminalStatus: 'COMPENSATED' }))).toBe('compensated')
  })

  test('the lifecycle wins over evidence for a non-COMPLETED run', () => {
    expect(
      resolveRunOutcome(evidence({ terminalStatus: 'CANCELLED', failureEvidenceCount: 4 })),
    ).toBe('cancelled')
    expect(
      resolveRunOutcome(evidence({ terminalStatus: 'COMPENSATED', warningEvidenceCount: 4 })),
    ).toBe('compensated')
  })
})

describe('THE INVARIANT: a run that suppressed a failure can never be success', () => {
  const statuses = ['COMPLETED', 'FAILED', 'CANCELLED', 'COMPENSATED', 'COMPENSATING', 'RUNNING']
  const failureCounts = [1, 2, 17]
  const warningCounts = [0, 1, 5]

  test('holds for every terminal status and every evidence shape', () => {
    for (const terminalStatus of statuses) {
      for (const failureEvidenceCount of failureCounts) {
        for (const warningEvidenceCount of warningCounts) {
          const outcome = resolveRunOutcome({
            terminalStatus,
            failureEvidenceCount,
            warningEvidenceCount,
          })
          expect(outcome).not.toBe('success')
          expect(outcome).not.toBe('success_with_warnings')
        }
      }
    }
  })

  test('the order-approval shape: reached END, three writes swallowed', () => {
    // Three `UPDATE_ENTITY` activities threw; every transition set
    // `continueOnActivityFailure: true`, so the run advanced to END and was
    // written COMPLETED. The verdict must not agree with that word.
    expect(
      resolveRunOutcome({
        terminalStatus: 'COMPLETED',
        failureEvidenceCount: 3,
        warningEvidenceCount: 0,
      }),
    ).toBe('partial_failure')
  })

  test('zero failure evidence is the ONLY way to reach success', () => {
    expect(resolveRunOutcome(evidence({ failureEvidenceCount: 0 }))).toBe('success')
    expect(resolveRunOutcome(evidence({ failureEvidenceCount: 1 }))).not.toBe('success')
  })
})

describe('outcome predicates', () => {
  test('partial_failure needs attention', () => {
    expect(isDegradedRunOutcome('partial_failure')).toBe(true)
    expect(isDegradedRunOutcome('success')).toBe(false)
    expect(isDegradedRunOutcome(null)).toBe(false)
  })

  test('partial_failure is NOT retryable as a whole run; only failure is', () => {
    // Maintainer decision 2026-07-30: replaying the graph would re-run every
    // part that already succeeded. Recovery is rerun-from-step.
    expect(isRetryableRunOutcome('partial_failure')).toBe(false)
    expect(isRetryableRunOutcome('failure')).toBe(true)
    expect(isRetryableRunOutcome('success')).toBe(false)
    expect(isRetryableRunOutcome('success_with_warnings')).toBe(false)
    expect(isRetryableRunOutcome('cancelled')).toBe(false)
    expect(isRetryableRunOutcome('compensated')).toBe(false)
    expect(isRetryableRunOutcome(null)).toBe(false)
  })

  test('the vocabulary is exactly the six spec values', () => {
    expect([...WORKFLOW_RUN_OUTCOMES]).toEqual([
      'success',
      'success_with_warnings',
      'partial_failure',
      'failure',
      'cancelled',
      'compensated',
    ])
    expect(isWorkflowRunOutcome('partial_failure')).toBe(true)
    expect(isWorkflowRunOutcome('COMPLETED')).toBe(false)
  })
})
