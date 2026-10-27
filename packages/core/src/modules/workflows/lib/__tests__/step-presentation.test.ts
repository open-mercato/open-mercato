/** @jest-environment node */

/**
 * Step presentation (spec `2026-07-30-workflow-run-outcomes.md`, Part 2).
 *
 * The thing under test is the reclassification: `WAITING_FOR_ACTIVITIES` and a
 * running `INVOKE_AGENT` are the engine WORKING, and painting them as an amber
 * pause is the bug this exists to fix. Amber is reserved for being blocked on
 * the outside world.
 */

import { describe, test, expect } from '@jest/globals'
import { deriveRunExecution, type RunEventInput } from '../run-execution'
import { presentationToWorkflowStatus, resolveStepPresentation } from '../step-presentation'

const STEP_INSTANCE_ID = 'si-1'

function event(
  eventType: string,
  eventData: Record<string, unknown>,
  occurredAt: string,
  stepInstanceId: string | null = STEP_INSTANCE_ID,
): RunEventInput {
  return { eventType, eventData, occurredAt, stepInstanceId }
}

function runOf(
  events: RunEventInput[],
  overrides: {
    instanceStatus?: string
    currentStepId?: string | null
    attention?: unknown
    stepStatus?: string
    stepType?: string
  } = {},
) {
  return deriveRunExecution({
    events,
    stepInstances: [
      {
        id: STEP_INSTANCE_ID,
        stepId: 'step-1',
        stepType: overrides.stepType ?? 'AUTOMATED',
        status: overrides.stepStatus ?? 'ACTIVE',
        enteredAt: '2026-07-30T10:00:00.000Z',
      },
    ],
    currentStepId: overrides.currentStepId === undefined ? 'step-1' : overrides.currentStepId,
    instanceStatus: overrides.instanceStatus ?? 'PAUSED',
    attention: overrides.attention,
  })
}

describe('working — the system is doing something right now', () => {
  test('WAITING_FOR_ACTIVITIES is working, not a pause', () => {
    // The single reclassification the maintainer asked for. `applyLiveInstanceStatus`
    // collapses the raw step status to `paused` for BOTH PAUSED and
    // WAITING_FOR_ACTIVITIES, so `paused` is exactly what a caller hands in —
    // and the presentation is what has to tell the two apart.
    const execution = runOf([], { instanceStatus: 'WAITING_FOR_ACTIVITIES' })
    expect(execution.stepStates.get('step-1')?.status).toBe('paused')
    expect(resolveStepPresentation(execution, { id: 'step-1', status: 'paused' }).state).toBe('working')
  })

  test('a bare PAUSED with nothing recorded stays amber rather than guessing', () => {
    const execution = runOf([], { instanceStatus: 'PAUSED' })
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' })
    expect(presentation.state).toBe('waiting')
    expect(presentation.reason).toBeNull()
  })

  test('a queued async activity says which activity is running', () => {
    const execution = runOf(
      [event('ACTIVITY_QUEUED', { activityName: 'Charge card', activityType: 'CALL_API' }, '2026-07-30T10:00:01.000Z')],
      { instanceStatus: 'WAITING_FOR_ACTIVITIES' },
    )
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' })

    expect(presentation.state).toBe('working')
    expect(presentation.reason?.params).toEqual({ activity: 'Charge card' })
    expect(presentation.animated).toBe(true)
  })

  test('a parked INVOKE_AGENT with no proposal yet is the agent RUNNING', () => {
    const execution = runOf([
      event('SIGNAL_AWAITING', { signalName: 'agent_orchestrator.proposal.ready', reason: 'INVOKE_AGENT' }, '2026-07-30T10:00:01.000Z'),
    ])
    const presentation = resolveStepPresentation(
      execution,
      { id: 'step-1', status: 'paused' },
      { agentId: 'deal_enricher', agentLabels: new Map([['deal_enricher', 'Deal Enricher']]) },
    )

    expect(presentation.state).toBe('working')
    expect(presentation.reason?.key).toBe('workflows.runState.reason.agentRunning')
    // The agent's LABEL, never its definition key.
    expect(presentation.reason?.params).toEqual({ agent: 'Deal Enricher' })
  })

  test('an unresolvable agent label degrades to the id rather than inventing a name', () => {
    const execution = runOf([
      event('SIGNAL_AWAITING', { reason: 'INVOKE_AGENT' }, '2026-07-30T10:00:01.000Z'),
    ])
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' }, { agentId: 'deal_enricher' })
    expect(presentation.reason?.params).toEqual({ agent: 'deal_enricher' })
  })

  test('a running sub-workflow is working, and names the child', () => {
    const execution = runOf([
      event('SIGNAL_AWAITING', { reason: 'SUB_WORKFLOW', childInstanceId: 'child-9' }, '2026-07-30T10:00:01.000Z'),
    ])
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' })
    expect(presentation.state).toBe('working')
    expect(presentation.reason?.params).toEqual({ workflow: 'child-9' })
  })

  test('a fork counts its still-running branches from the branch settle events', () => {
    const execution = deriveRunExecution({
      events: [
        event('PARALLEL_FORK_OPENED', { forkStepId: 'fork', joinStepId: 'join', branchKeys: ['t1', 't2', 't3'] }, '2026-07-30T10:00:00.000Z', null),
        event('PARALLEL_BRANCH_COMPLETED', { branchKey: 't1' }, '2026-07-30T10:00:05.000Z', null),
      ],
      currentStepId: 'fork',
      instanceStatus: 'FORKED',
    })
    const presentation = resolveStepPresentation(execution, { id: 'fork', status: 'active' })

    expect(presentation.state).toBe('working')
    expect(presentation.reason?.params).toEqual({ running: 2, total: 3 })
  })

  test('a completed join stops claiming the fork is still running', () => {
    const execution = deriveRunExecution({
      events: [
        event('PARALLEL_FORK_OPENED', { forkStepId: 'fork', joinStepId: 'join', branchKeys: ['t1'] }, '2026-07-30T10:00:00.000Z', null),
        event('PARALLEL_BRANCH_COMPLETED', { branchKey: 't1' }, '2026-07-30T10:00:05.000Z', null),
        event('PARALLEL_JOIN_COMPLETED', { joinStepId: 'join' }, '2026-07-30T10:00:06.000Z', null),
      ],
    })
    expect(execution.waits.has('fork')).toBe(false)
  })
})

describe('waiting — blocked on the outside world', () => {
  test('a user task waits for its role queue, never for a named individual', () => {
    const execution = runOf([
      event('USER_TASK_CREATED', { userTaskId: 'ut-1', assignedTo: 'user-42', assignedToRoles: ['Sales Rep'] }, '2026-07-30T10:00:01.000Z'),
    ])
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' })

    expect(presentation.state).toBe('waiting')
    expect(presentation.reason?.params).toEqual({ queue: 'Sales Rep' })
    // §6.4 owns who may see a task's owner; this line must not become a way around it.
    expect(JSON.stringify(presentation.reason)).not.toContain('user-42')
    expect(presentation.animated).toBe(false)
  })

  test('a user task with only an individual assignee says so without naming them', () => {
    const execution = runOf([
      event('USER_TASK_CREATED', { userTaskId: 'ut-1', assignedTo: 'user-42' }, '2026-07-30T10:00:01.000Z'),
    ])
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' })
    expect(presentation.reason?.key).toBe('workflows.runState.reason.userTaskAssignee')
    expect(JSON.stringify(presentation.reason)).not.toContain('user-42')
  })

  test('a timer waits until its absolute fire time', () => {
    const execution = runOf([
      event('TIMER_AWAITING', { fireAt: '2026-08-01T09:00:00.000Z' }, '2026-07-30T10:00:01.000Z'),
    ])
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' })
    expect(presentation.state).toBe('waiting')
    expect(presentation.reason?.key).toBe('workflows.runState.reason.timer')
  })

  test('a signal wait names the signal', () => {
    const execution = runOf([
      event('SIGNAL_AWAITING', { signalName: 'payment.confirmed' }, '2026-07-30T10:00:01.000Z'),
    ])
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' })
    expect(presentation.state).toBe('waiting')
    expect(presentation.reason?.params).toEqual({ signal: 'payment.confirmed' })
  })

  test('a condition wait reports its timeout', () => {
    const execution = runOf([
      event('CONDITION_AWAITING', { stepId: 'step-1', deadlineAt: '2026-07-30T12:00:00.000Z' }, '2026-07-30T10:00:01.000Z'),
    ])
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' })
    expect(presentation.state).toBe('waiting')
    expect(presentation.reason?.key).toBe('workflows.runState.reason.conditionUntil')
  })

  test('a disposition task raised for the agent flips the step from working to waiting', () => {
    // The ONLY durable thing that separates "the agent is still running" from
    // "a person has not decided yet": the invoke-agent worker's own user_task
    // branch logs nothing at all.
    const execution = runOf([
      event('SIGNAL_AWAITING', { reason: 'INVOKE_AGENT' }, '2026-07-30T10:00:01.000Z'),
      event('USER_TASK_CREATED', { userTaskId: 'ut-1', proposalId: 'p-7', agentId: 'deal_enricher' }, '2026-07-30T10:02:00.000Z'),
    ])
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' })

    expect(presentation.state).toBe('waiting')
    expect(presentation.reason?.key).toBe('workflows.runState.reason.agentDisposition')
  })
})

describe('attention and terminal states', () => {
  test('a failure-queue park outranks whatever the step was waiting for', () => {
    const execution = runOf(
      [event('TIMER_AWAITING', { fireAt: '2026-08-01T09:00:00.000Z' }, '2026-07-30T10:00:01.000Z')],
      { attention: { reason: 'activity failed' } },
    )
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' })
    expect(presentation.state).toBe('attention')
  })

  test('attention only describes the step the run is parked on', () => {
    const execution = runOf([], { attention: { reason: 'activity failed' }, currentStepId: 'other' })
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'active' })
    expect(presentation.state).not.toBe('attention')
  })

  test('a terminal step carries no reason line', () => {
    const execution = runOf([], { stepStatus: 'COMPLETED', currentStepId: null })
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'completed' })
    expect(presentation).toMatchObject({ state: 'completed', reason: null, animated: false })
  })

  test('a working step carries the current attempt start so it can say how long', () => {
    const execution = runOf([], { instanceStatus: 'WAITING_FOR_ACTIVITIES' })
    const presentation = resolveStepPresentation(execution, { id: 'step-1', status: 'paused' })
    expect(presentation.startedAt?.toISOString()).toBe('2026-07-30T10:00:00.000Z')
  })
})

describe('evidence lifecycle', () => {
  test('a resumed wait stops being reported', () => {
    const execution = runOf([
      event('SIGNAL_AWAITING', { signalName: 'payment.confirmed' }, '2026-07-30T10:00:01.000Z'),
      event('SIGNAL_RECEIVED', { signalName: 'payment.confirmed' }, '2026-07-30T10:05:00.000Z'),
    ])
    expect(execution.waits.has('step-1')).toBe(false)
  })

  test('re-entering a step discards the previous attempt evidence', () => {
    const execution = runOf([
      event('TIMER_AWAITING', { fireAt: '2026-08-01T09:00:00.000Z' }, '2026-07-30T10:00:01.000Z'),
      event('STEP_ENTERED', { stepId: 'step-1' }, '2026-07-30T10:06:00.000Z'),
    ])
    expect(execution.waits.has('step-1')).toBe(false)
  })

  test('an event whose step instance is unknown attributes to nothing rather than guessing', () => {
    const execution = runOf([
      event('TIMER_AWAITING', { fireAt: '2026-08-01T09:00:00.000Z' }, '2026-07-30T10:00:01.000Z', 'si-unknown'),
    ])
    expect(execution.waits.size).toBe(0)
  })
})

describe('paint mapping', () => {
  test('working is info, waiting is warning, attention is destructive-adjacent', () => {
    expect(presentationToWorkflowStatus('working')).toBe('working')
    expect(presentationToWorkflowStatus('waiting')).toBe('waiting')
    expect(presentationToWorkflowStatus('attention')).toBe('needs_attention')
  })
})
