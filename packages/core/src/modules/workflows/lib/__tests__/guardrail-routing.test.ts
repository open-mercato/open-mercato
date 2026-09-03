/**
 * Guardrail escalation + the rejection/error split (spec 7.2, 7.3)
 *
 * A guardrail `block` is a governance outcome, not an infra failure, and a
 * rejected proposal is a business route, not an error. Both used to reach the
 * workflow as the same thing. These tests pin the split, and pin that a step
 * which wired neither keeps the exact fail-stop it had.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'

const sendSignalMock = jest.fn<Promise<void>, [unknown, unknown, unknown]>()
const completeWorkflowMock = jest.fn<Promise<void>, [unknown, unknown, string, string, unknown?]>()

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })),
}))

jest.mock('../signal-handler', () => ({
  sendSignal: (...args: unknown[]) => sendSignalMock(args[0], args[1], args[2]),
}))

jest.mock('../workflow-executor', () => ({
  completeWorkflow: (...args: unknown[]) =>
    completeWorkflowMock(args[0], args[1], args[2] as string, args[3] as string, args[4]),
}))

import { INVOKE_AGENT_SIGNAL_NAME } from '../activity-executor'
import { handleInvokeAgentJob } from '../activity-worker-handler'
import type { WorkflowActivityJobInvokeAgent } from '../activity-queue-types'
import {
  OUTCOME_TRANSITION_KIND,
  WORKFLOW_GUARDRAIL_BLOCK_CONTEXT_KEY,
  isGuardrailBlockedError,
  mapDispositionToAgentOutcome,
  readGuardrailBlockEvidenceRef,
  resolveAgentOutcomeHandling,
} from '../outcome-routing'

const tenantId = 'tenant-1'
const organizationId = 'org-1'
const stepId = 'assess_risk'
const definitionId = 'definition-1'

/** Shaped exactly like `AgentGuardrailBlockedError` without importing enterprise. */
function guardrailBlockedError(): Error & Record<string, unknown> {
  const error = new Error('[internal] pre-call guardrail block (prompt_injection)') as Error &
    Record<string, unknown>
  error.name = 'AgentGuardrailBlockedError'
  error.code = 'agent_guardrail_blocked'
  error.phase = 'input'
  error.kind = 'prompt_injection'
  error.guardrailSetVersion = 'v3'
  // A real evidence blob never leaves the AgentGuardrailCheck row; if one is
  // attached to the error it must not travel into the run context.
  error.evidence = { prompt: 'customer SSN 123-45-6789' }
  return error
}

function makeJob(): WorkflowActivityJobInvokeAgent {
  return {
    kind: 'invoke_agent',
    workflowInstanceId: 'instance-1',
    stepInstanceId: 'step-instance-1',
    stepId,
    signalName: INVOKE_AGENT_SIGNAL_NAME,
    agentId: 'risk.assessor',
    input: {},
    onResult: { autoApproveThreshold: 0 },
    tenantId,
    organizationId,
    userId: 'user-1',
  }
}

function makeDeps(transitions: Array<Record<string, unknown>>) {
  const invokeAgentForWorkflow = jest.fn().mockRejectedValue(guardrailBlockedError())
  const instance = {
    id: 'instance-1',
    definitionId,
    currentStepId: stepId,
    status: 'PAUSED',
    tenantId,
    organizationId,
  }
  const definition = {
    id: definitionId,
    workflowId: 'risk',
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId, stepName: 'Assess', stepType: 'AUTOMATED' },
        { stepId: 'review', stepName: 'Review', stepType: 'USER_TASK' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions,
    },
    tenantId,
    organizationId,
  }
  const em = {
    findOne: jest.fn(async (_entity: unknown, where: unknown) => {
      const id = (where as { id?: string })?.id
      if (id === definitionId) return definition
      return instance
    }),
    flush: jest.fn(),
  } as unknown as EntityManager
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'agentWorkflowBridge') return { invokeAgentForWorkflow }
      throw new Error(`unexpected resolve(${name})`)
    }),
  } as unknown as AwilixContainer
  return { em, container, invokeAgentForWorkflow }
}

const guardrailRoute = {
  transitionId: 't_guardrail',
  fromStepId: stepId,
  toStepId: 'review',
  trigger: 'auto',
  kind: OUTCOME_TRANSITION_KIND,
  outcomeKind: 'guardrailBlocked',
}

beforeEach(() => {
  sendSignalMock.mockReset().mockResolvedValue(undefined)
  completeWorkflowMock.mockReset().mockResolvedValue(undefined)
})

describe('guardrail block recognition', () => {
  it('recognizes the runtime error structurally, without importing agent_orchestrator', () => {
    expect(isGuardrailBlockedError(guardrailBlockedError())).toBe(true)
    expect(isGuardrailBlockedError({ guardrailBlocked: true })).toBe(true)
    expect(isGuardrailBlockedError(new Error('unknown agent id'))).toBe(false)
    expect(isGuardrailBlockedError(null)).toBe(false)
  })

  it('binds the guardrail classification only — never the evidence blob', () => {
    const ref = readGuardrailBlockEvidenceRef(guardrailBlockedError())
    expect(ref).toEqual({ phase: 'input', kind: 'prompt_injection', guardrailSetVersion: 'v3' })
    expect(ref).not.toHaveProperty('evidence')
  })
})

describe('guardrail escalation in the activity worker', () => {
  it('routes a block down the wired guardrailBlocked handle instead of failing the instance', async () => {
    const { em, container } = makeDeps([guardrailRoute])

    await handleInvokeAgentJob(em, container, makeJob())

    expect(completeWorkflowMock).not.toHaveBeenCalled()
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    const [, , options] = sendSignalMock.mock.calls[0] as [
      unknown,
      unknown,
      { signalName: string; payload: Record<string, unknown> },
    ]
    expect(options.signalName).toBe(INVOKE_AGENT_SIGNAL_NAME)
    expect(options.payload.disposition).toBe('guardrail_blocked')
    expect(options.payload[WORKFLOW_GUARDRAIL_BLOCK_CONTEXT_KEY]).toEqual({
      stepId,
      phase: 'input',
      kind: 'prompt_injection',
      guardrailSetVersion: 'v3',
    })
    expect(JSON.stringify(options.payload)).not.toContain('123-45-6789')
  })

  it('keeps the untouched fail-stop when no guardrail route is wired', async () => {
    const { em, container } = makeDeps([
      { transitionId: 't_next', fromStepId: stepId, toStepId: 'end', trigger: 'auto' },
    ])

    await handleInvokeAgentJob(em, container, makeJob())

    expect(sendSignalMock).not.toHaveBeenCalled()
    expect(completeWorkflowMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'instance-1',
      'FAILED',
      expect.anything(),
    )
  })

  it('applies inherited error handling when a step opted into another outcome', async () => {
    const invokeAgentForWorkflow = jest.fn().mockRejectedValue(new Error('unknown agent id'))
    const { em, container } = makeDeps([guardrailRoute])
    ;(container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'agentWorkflowBridge') return { invokeAgentForWorkflow }
      throw new Error(`unexpected resolve(${name})`)
    })

    await handleInvokeAgentJob(em, container, makeJob())

    expect(sendSignalMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ agentOutcome: 'error' }),
    )
    expect(completeWorkflowMock).not.toHaveBeenCalled()
  })

  it('routes an ordinary terminal failure through a wired error outcome', async () => {
    const errorRoute = { ...guardrailRoute, transitionId: 't_error', outcomeKind: 'error' }
    const invokeAgentForWorkflow = jest.fn().mockRejectedValue(new Error('provider unavailable'))
    const { em, container } = makeDeps([errorRoute])
    ;(container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'agentWorkflowBridge') return { invokeAgentForWorkflow }
      throw new Error(`unexpected resolve(${name})`)
    })

    await handleInvokeAgentJob(em, container, makeJob())

    expect(completeWorkflowMock).not.toHaveBeenCalled()
    const [, , options] = sendSignalMock.mock.calls[0] as [
      unknown,
      unknown,
      { agentOutcome: string; payload: Record<string, unknown> },
    ]
    expect(options.agentOutcome).toBe('error')
    expect(options.payload).toHaveProperty('__error')
  })
})

describe('rejection is a business route, not an error', () => {
  const definition = {
    steps: [
      { stepId, stepName: 'Assess', stepType: 'AUTOMATED' },
      { stepId: 'review', stepName: 'Review', stepType: 'USER_TASK' },
      { stepId: 'halt', stepName: 'Halt', stepType: 'END' },
    ],
    transitions: [
      {
        transitionId: 't_rejected',
        fromStepId: stepId,
        toStepId: 'review',
        trigger: 'auto',
        kind: OUTCOME_TRANSITION_KIND,
        outcomeKind: 'rejected',
      },
      {
        transitionId: 't_error',
        fromStepId: stepId,
        toStepId: 'halt',
        trigger: 'auto',
        kind: OUTCOME_TRANSITION_KIND,
        outcomeKind: 'error',
      },
    ],
  }

  it('sends a rejected proposal and an agent failure to different steps', () => {
    const rejected = resolveAgentOutcomeHandling(definition, stepId, 'rejected')
    const failed = resolveAgentOutcomeHandling(definition, stepId, 'error')
    expect(rejected).toMatchObject({ kind: 'route' })
    expect(failed).toMatchObject({ kind: 'route' })
    if (rejected.kind !== 'route' || failed.kind !== 'route') return
    expect(rejected.transition.toStepId).toBe('review')
    expect(failed.transition.toStepId).toBe('halt')
  })

  it('keeps a guardrail block distinct from both', () => {
    expect(mapDispositionToAgentOutcome('guardrail_blocked')).toBe('guardrailBlocked')
    expect(mapDispositionToAgentOutcome('rejected')).toBe('rejected')
    expect(resolveAgentOutcomeHandling(definition, stepId, 'guardrailBlocked')).toMatchObject({
      kind: 'inherit',
      outcome: 'guardrailBlocked',
    })
  })
})
