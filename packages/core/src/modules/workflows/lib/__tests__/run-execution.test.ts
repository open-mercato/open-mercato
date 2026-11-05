/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  deriveRunExecution,
  isRouteTaken,
  resolveNodeRunStatus,
  stepInstanceStatusToRunStatus,
  stepPairKey,
} from '../run-execution'

function event(eventType: string, eventData: Record<string, unknown>, occurredAt: string) {
  return { eventType, eventData, occurredAt }
}

describe('deriveRunExecution — step states from events', () => {
  test('an entered-then-exited step reads completed with its measured duration', () => {
    const execution = deriveRunExecution({
      events: [
        event('STEP_ENTERED', { stepId: 'validate' }, '2026-07-29T10:00:00.000Z'),
        event('STEP_EXITED', { stepId: 'validate' }, '2026-07-29T10:00:02.500Z'),
      ],
    })

    const state = execution.stepStates.get('validate')
    expect(state?.status).toBe('completed')
    expect(state?.durationMs).toBe(2500)
    expect(state?.attempts).toBe(1)
  })

  test('replays newest-first API ordering oldest-first so the terminal event wins', () => {
    const execution = deriveRunExecution({
      events: [
        event('STEP_EXITED', { stepId: 'validate' }, '2026-07-29T10:00:02.000Z'),
        event('STEP_ENTERED', { stepId: 'validate' }, '2026-07-29T10:00:00.000Z'),
      ],
    })

    expect(execution.stepStates.get('validate')?.status).toBe('completed')
    expect(execution.stepStates.get('validate')?.durationMs).toBe(2000)
  })

  test('a re-entered step drops the previous terminal timestamps instead of reporting a stale duration', () => {
    const execution = deriveRunExecution({
      events: [
        event('STEP_ENTERED', { stepId: 'charge' }, '2026-07-29T10:00:00.000Z'),
        event('STEP_FAILED', { stepId: 'charge' }, '2026-07-29T10:00:01.000Z'),
        event('STEP_ENTERED', { stepId: 'charge' }, '2026-07-29T10:05:00.000Z'),
      ],
    })

    const state = execution.stepStates.get('charge')
    expect(state?.status).toBe('active')
    expect(state?.completedAt).toBeNull()
    expect(state?.durationMs).toBeNull()
  })

  test('the legacy PascalCase event spellings are still understood', () => {
    const execution = deriveRunExecution({
      events: [
        event('StepEntered', { stepId: 'legacy' }, '2026-07-29T10:00:00.000Z'),
        event('StepExited', { stepId: 'legacy' }, '2026-07-29T10:00:01.000Z'),
      ],
    })

    expect(execution.stepStates.get('legacy')?.status).toBe('completed')
  })

  test('a skipped step is distinguished from a completed one', () => {
    const execution = deriveRunExecution({
      events: [
        event('STEP_ENTERED', { stepId: 'optional' }, '2026-07-29T10:00:00.000Z'),
        event('STEP_SKIPPED', { stepId: 'optional' }, '2026-07-29T10:00:00.500Z'),
      ],
    })

    expect(execution.stepStates.get('optional')?.status).toBe('skipped')
  })
})

describe('deriveRunExecution — step instances outrank events', () => {
  test('a completed step instance repaints a step the truncated event page never showed entering', () => {
    const execution = deriveRunExecution({
      // The detail page reads the newest 100 events; on a long run an early
      // step's STEP_ENTERED has fallen off the page entirely.
      events: [],
      stepInstances: [
        {
          stepId: 'validate',
          status: 'COMPLETED',
          enteredAt: '2026-07-29T10:00:00.000Z',
          exitedAt: '2026-07-29T10:00:04.000Z',
          executionTimeMs: 3980,
          retryCount: 0,
        },
      ],
    })

    const state = execution.stepStates.get('validate')
    expect(state?.status).toBe('completed')
    expect(state?.durationMs).toBe(3980)
  })

  test('the engine-measured execution time wins over the timestamp difference', () => {
    const execution = deriveRunExecution({
      stepInstances: [
        {
          stepId: 'charge',
          status: 'COMPLETED',
          enteredAt: '2026-07-29T10:00:00.000Z',
          exitedAt: '2026-07-29T10:00:10.000Z',
          executionTimeMs: 120,
          retryCount: 0,
        },
      ],
    })

    expect(execution.stepStates.get('charge')?.durationMs).toBe(120)
  })

  test('retryCount surfaces as attempts (retries + the original attempt)', () => {
    const execution = deriveRunExecution({
      stepInstances: [{ stepId: 'charge', status: 'FAILED', retryCount: 2 }],
    })

    expect(execution.stepStates.get('charge')?.attempts).toBe(3)
  })

  test('the newest execution of a repeated step is the one painted', () => {
    const execution = deriveRunExecution({
      stepInstances: [
        {
          stepId: 'charge',
          status: 'FAILED',
          enteredAt: '2026-07-29T10:00:00.000Z',
          exitedAt: '2026-07-29T10:00:01.000Z',
        },
        {
          stepId: 'charge',
          status: 'COMPLETED',
          enteredAt: '2026-07-29T10:05:00.000Z',
          exitedAt: '2026-07-29T10:05:01.000Z',
        },
      ],
    })

    expect(execution.stepStates.get('charge')?.status).toBe('completed')
  })

  test('a CANCELLED step instance reads as skipped rather than falling through to pending', () => {
    expect(stepInstanceStatusToRunStatus('CANCELLED')).toBe('skipped')
    expect(stepInstanceStatusToRunStatus('PENDING')).toBe('pending')
    expect(stepInstanceStatusToRunStatus('ACTIVE')).toBe('active')
    expect(stepInstanceStatusToRunStatus('anything-else')).toBe('pending')
  })
})

describe('deriveRunExecution — the taken path', () => {
  test('records each executed transition with its id and endpoints', () => {
    const execution = deriveRunExecution({
      events: [
        event(
          'TRANSITION_EXECUTED',
          { fromStepId: 'start', toStepId: 'validate', transitionId: 't_1' },
          '2026-07-29T10:00:00.000Z'
        ),
      ],
    })

    expect(execution.routes).toHaveLength(1)
    expect(execution.takenTransitionIds.has('t_1')).toBe(true)
    expect(execution.takenStepPairs.has(stepPairKey('start', 'validate'))).toBe(true)
  })

  test('a transition logged without an id still paints, matched on its endpoints', () => {
    const execution = deriveRunExecution({
      events: [
        event('TRANSITION_EXECUTED', { fromStepId: 'a', toStepId: 'b' }, '2026-07-29T10:00:00.000Z'),
      ],
    })

    expect(isRouteTaken(execution, { transitionId: 't_unknown', fromStepId: 'a', toStepId: 'b' })).toBe(true)
  })

  test('an untaken route is not reported as taken', () => {
    const execution = deriveRunExecution({
      events: [
        event('TRANSITION_EXECUTED', { fromStepId: 'a', toStepId: 'b' }, '2026-07-29T10:00:00.000Z'),
      ],
    })

    expect(isRouteTaken(execution, { transitionId: 't_2', fromStepId: 'a', toStepId: 'rejected' })).toBe(false)
  })

  test('a malformed transition event is ignored rather than inventing a route', () => {
    const execution = deriveRunExecution({
      events: [event('TRANSITION_EXECUTED', { fromStepId: 'a' }, '2026-07-29T10:00:00.000Z')],
    })

    expect(execution.routes).toHaveLength(0)
  })
})

describe('live instance status', () => {
  test('a failed instance paints its parked step failed', () => {
    const execution = deriveRunExecution({
      events: [event('STEP_ENTERED', { stepId: 'charge' }, '2026-07-29T10:00:00.000Z')],
      currentStepId: 'charge',
      instanceStatus: 'FAILED',
    })

    expect(execution.stepStates.get('charge')?.status).toBe('failed')
  })

  test('a paused instance paints its parked step paused', () => {
    const execution = deriveRunExecution({
      currentStepId: 'await_approval',
      instanceStatus: 'PAUSED',
    })

    expect(execution.stepStates.get('await_approval')?.status).toBe('paused')
  })

  test('never overrides a step that already reached a terminal state', () => {
    const execution = deriveRunExecution({
      stepInstances: [{ stepId: 'charge', status: 'COMPLETED', exitedAt: '2026-07-29T10:00:01.000Z' }],
      currentStepId: 'charge',
      instanceStatus: 'PAUSED',
    })

    expect(execution.stepStates.get('charge')?.status).toBe('completed')
  })
})

describe('resolveNodeRunStatus', () => {
  const emptyExecution = deriveRunExecution({})

  test('a start node the run has moved past reads completed', () => {
    expect(resolveNodeRunStatus(emptyExecution, { id: 'start', type: 'start' })).toBe('completed')
  })

  test('a start node the run is still sitting on reads active', () => {
    expect(
      resolveNodeRunStatus(emptyExecution, { id: 'start', type: 'start' }, { currentStepId: 'start' })
    ).toBe('active')
  })

  test('an end node is pending until the run completes', () => {
    expect(resolveNodeRunStatus(emptyExecution, { id: 'end', type: 'end' })).toBe('pending')
    expect(
      resolveNodeRunStatus(emptyExecution, { id: 'end', type: 'end' }, { instanceStatus: 'COMPLETED' })
    ).toBe('completed')
  })

  test('any other node without an execution record is pending', () => {
    expect(resolveNodeRunStatus(emptyExecution, { id: 'charge', type: 'automated' })).toBe('pending')
  })

  test('a recorded state always wins over the node-type default', () => {
    const execution = deriveRunExecution({
      stepInstances: [{ stepId: 'end', status: 'FAILED' }],
    })
    expect(resolveNodeRunStatus(execution, { id: 'end', type: 'end' }, { instanceStatus: 'COMPLETED' })).toBe(
      'failed'
    )
  })
})

describe('empty input', () => {
  test('derives an empty overlay without throwing', () => {
    const execution = deriveRunExecution({})
    expect(execution.stepStates.size).toBe(0)
    expect(execution.routes).toEqual([])
    expect(execution.takenTransitionIds.size).toBe(0)
  })
})

describe('deriveRunExecution — error/guardrail-routed steps are not painted "done"', () => {
  const stepInstance = (stepId: string, status: string) => ({
    stepId,
    status,
    enteredAt: '2026-07-29T10:00:00.000Z',
    exitedAt: '2026-07-29T10:00:03.000Z',
  })

  test('an agent step that exits via its error outcome shows failed, not completed', () => {
    const execution = deriveRunExecution({
      events: [
        event('STEP_ENTERED', { stepId: 'assess' }, '2026-07-29T10:00:00.000Z'),
        event('STEP_EXITED', { stepId: 'assess' }, '2026-07-29T10:00:02.000Z'),
        event('OUTCOME_ROUTED', { stepId: 'assess', outcome: 'error', toStepId: 'retry_wait' }, '2026-07-29T10:00:02.500Z'),
      ],
      // The engine records the routed step COMPLETED — the fix must still repaint it.
      stepInstances: [stepInstance('assess', 'COMPLETED')],
    })
    expect(execution.stepStates.get('assess')?.status).toBe('failed')
  })

  test('a guardrailBlocked outcome also shows failed', () => {
    const execution = deriveRunExecution({
      events: [
        event('STEP_ENTERED', { stepId: 'assess' }, '2026-07-29T10:00:00.000Z'),
        event('STEP_EXITED', { stepId: 'assess' }, '2026-07-29T10:00:02.000Z'),
        event('OUTCOME_ROUTED', { stepId: 'assess', outcome: 'guardrailBlocked', toStepId: 'review' }, '2026-07-29T10:00:02.500Z'),
      ],
      stepInstances: [stepInstance('assess', 'COMPLETED')],
    })
    expect(execution.stepStates.get('assess')?.status).toBe('failed')
  })

  test('an approved outcome stays completed (green)', () => {
    const execution = deriveRunExecution({
      events: [
        event('STEP_ENTERED', { stepId: 'assess' }, '2026-07-29T10:00:00.000Z'),
        event('STEP_EXITED', { stepId: 'assess' }, '2026-07-29T10:00:02.000Z'),
        event('OUTCOME_ROUTED', { stepId: 'assess', outcome: 'approved', toStepId: 'issue' }, '2026-07-29T10:00:02.500Z'),
      ],
      stepInstances: [stepInstance('assess', 'COMPLETED')],
    })
    expect(execution.stepStates.get('assess')?.status).toBe('completed')
  })

  test('a successful retry after an error shows completed — the flag is per attempt', () => {
    const execution = deriveRunExecution({
      events: [
        event('STEP_ENTERED', { stepId: 'assess' }, '2026-07-29T10:00:00.000Z'),
        event('STEP_EXITED', { stepId: 'assess' }, '2026-07-29T10:00:01.000Z'),
        event('OUTCOME_ROUTED', { stepId: 'assess', outcome: 'error', toStepId: 'retry_wait' }, '2026-07-29T10:00:01.500Z'),
        // 15m later the retry re-enters and this time the agent succeeds.
        event('STEP_ENTERED', { stepId: 'assess' }, '2026-07-29T10:15:00.000Z'),
        event('STEP_EXITED', { stepId: 'assess' }, '2026-07-29T10:15:02.000Z'),
        event('OUTCOME_ROUTED', { stepId: 'assess', outcome: 'approved', toStepId: 'issue' }, '2026-07-29T10:15:02.500Z'),
      ],
      stepInstances: [stepInstance('assess', 'COMPLETED')],
    })
    expect(execution.stepStates.get('assess')?.status).toBe('completed')
  })

  test('a §5.9 error route (ERROR_ROUTED / failedStepId) also shows failed', () => {
    const execution = deriveRunExecution({
      events: [
        event('STEP_ENTERED', { stepId: 'charge' }, '2026-07-29T10:00:00.000Z'),
        event('STEP_EXITED', { stepId: 'charge' }, '2026-07-29T10:00:02.000Z'),
        event('ERROR_ROUTED', { failedStepId: 'charge', toStepId: 'handle_error' }, '2026-07-29T10:00:02.500Z'),
      ],
      stepInstances: [stepInstance('charge', 'COMPLETED')],
    })
    expect(execution.stepStates.get('charge')?.status).toBe('failed')
  })
})
