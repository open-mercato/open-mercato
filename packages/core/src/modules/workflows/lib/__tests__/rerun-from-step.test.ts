/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { computeContextDiff, resolveRerunEligibility } from '../rerun-from-step'

const DEFINITION_STEPS = [
  { stepId: 'start', stepType: 'START' },
  { stepId: 'charge', stepType: 'AUTOMATED' },
  { stepId: 'approve', stepType: 'USER_TASK' },
]

function execution(overrides: Partial<{ id: string; stepId: string; stepType: string; status: string; enteredAt: string }> = {}) {
  return {
    id: 'si-1',
    stepId: 'charge',
    stepType: 'AUTOMATED',
    status: 'FAILED',
    enteredAt: '2026-07-29T10:00:00.000Z',
    ...overrides,
  }
}

function resolve(overrides: Partial<Parameters<typeof resolveRerunEligibility>[0]> = {}) {
  return resolveRerunEligibility({
    instanceStatus: 'FAILED',
    stepId: 'charge',
    definitionSteps: DEFINITION_STEPS,
    stepExecutions: [execution()],
    ...overrides,
  })
}

describe('resolveRerunEligibility', () => {
  test('allows replaying a terminal step of a FAILED instance', () => {
    const result = resolve()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.supersededStepInstanceId).toBe('si-1')
  })

  test('allows replaying a step of a PARKED (PAUSED) instance — the failure queue', () => {
    expect(resolve({ instanceStatus: 'PAUSED' }).ok).toBe(true)
  })

  test('refuses a RUNNING instance, which would race the execution loop', () => {
    const result = resolve({ instanceStatus: 'RUNNING' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('WORKFLOW_INSTANCE_NOT_RERUNNABLE')
  })

  test('refuses a COMPLETED or CANCELLED instance', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'COMPENSATING']) {
      const result = resolve({ instanceStatus: status })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('WORKFLOW_INSTANCE_NOT_RERUNNABLE')
    }
  })

  test('refuses a step the definition no longer declares', () => {
    const result = resolve({ stepId: 'deleted', stepExecutions: [execution({ stepId: 'deleted' })] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('WORKFLOW_STEP_NOT_IN_DEFINITION')
  })

  test('refuses a step that never executed in this run', () => {
    const result = resolve({ stepId: 'approve', stepExecutions: [execution()] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('WORKFLOW_STEP_NEVER_EXECUTED')
  })

  test('refuses while the step is still parked — the §7.4 dependency', () => {
    // A queue job, and for an agent step a pending proposal, are still
    // addressed to THIS attempt; rerunning would orphan both and let the run
    // resume twice.
    for (const status of ['PENDING', 'ACTIVE']) {
      const result = resolve({ stepExecutions: [execution({ status })] })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('WORKFLOW_STEP_STILL_PARKED')
    }
  })

  test('refuses when the step changed type since the run — the structural-drift guard', () => {
    // A FAILED instance is not "active", so the definition PUT guard permits an
    // in-place structural edit. Replaying would execute something the run never
    // ran.
    const result = resolve({ stepExecutions: [execution({ stepType: 'USER_TASK' })] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('WORKFLOW_STEP_TYPE_CHANGED')
  })

  test('judges the LATEST attempt of a repeated step, not the first', () => {
    const stillRunning = resolve({
      stepExecutions: [
        execution({ id: 'si-1', status: 'FAILED', enteredAt: '2026-07-29T10:00:00.000Z' }),
        execution({ id: 'si-2', status: 'ACTIVE', enteredAt: '2026-07-29T11:00:00.000Z' }),
      ],
    })
    expect(stillRunning.ok).toBe(false)

    const settled = resolve({
      stepExecutions: [
        execution({ id: 'si-1', status: 'ACTIVE', enteredAt: '2026-07-29T10:00:00.000Z' }),
        execution({ id: 'si-2', status: 'FAILED', enteredAt: '2026-07-29T11:00:00.000Z' }),
      ],
    })
    expect(settled.ok).toBe(true)
    if (settled.ok) expect(settled.supersededStepInstanceId).toBe('si-2')
  })

  test('a SKIPPED or CANCELLED previous attempt is terminal and rerunnable', () => {
    expect(resolve({ stepExecutions: [execution({ status: 'SKIPPED' })] }).ok).toBe(true)
    expect(resolve({ stepExecutions: [execution({ status: 'CANCELLED' })] }).ok).toBe(true)
  })

  test('the decision never mutates its inputs — the terminal row stays terminal', () => {
    const executions = [execution({ status: 'FAILED' })]
    const snapshot = JSON.stringify(executions)
    resolveRerunEligibility({
      instanceStatus: 'FAILED',
      stepId: 'charge',
      definitionSteps: DEFINITION_STEPS,
      stepExecutions: executions,
    })
    expect(JSON.stringify(executions)).toBe(snapshot)
  })
})

describe('computeContextDiff', () => {
  test('records only the keys the caller actually changed', () => {
    expect(
      computeContextDiff({ amount: 100, currency: 'EUR' }, { amount: 250, currency: 'EUR' })
    ).toEqual({ amount: { from: 100, to: 250 } })
  })

  test('records a new key with a null "from"', () => {
    expect(computeContextDiff({}, { retryReason: 'gateway fixed' })).toEqual({
      retryReason: { from: null, to: 'gateway fixed' },
    })
  })

  test('compares structurally, so a re-sent object is not an edit', () => {
    expect(computeContextDiff({ order: { id: 'o-1' } }, { order: { id: 'o-1' } })).toEqual({})
  })

  test('an absent patch is an empty diff, not a crash', () => {
    expect(computeContextDiff({ a: 1 }, undefined)).toEqual({})
    expect(computeContextDiff(null, null)).toEqual({})
  })
})
