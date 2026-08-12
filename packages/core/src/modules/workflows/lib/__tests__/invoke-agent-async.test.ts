/**
 * INVOKE_AGENT async execution tests.
 *
 * Covers the fix that runs an INVOKE_AGENT step's agent OUTSIDE the workflow
 * transaction: `executeInvokeAgent` enqueues a job + parks, and the worker's
 * `handleInvokeAgentJob` runs the agent and resumes the parked step.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'

const enqueueMock = jest.fn<Promise<string>, [unknown, unknown?]>()
const sendSignalMock = jest.fn<Promise<void>, [unknown, unknown, unknown]>()
const completeWorkflowMock = jest.fn<Promise<void>, [unknown, unknown, string, string, unknown?]>()

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(() => ({ enqueue: enqueueMock })),
}))

jest.mock('../signal-handler', () => ({
  sendSignal: (...args: unknown[]) => sendSignalMock(args[0], args[1], args[2]),
}))

jest.mock('../workflow-executor', () => ({
  completeWorkflow: (...args: unknown[]) =>
    completeWorkflowMock(args[0], args[1], args[2] as string, args[3] as string, args[4]),
}))

import {
  AgentSuspensionUnsupportedError,
  executeActivity,
  executeInvokeAgent,
  INVOKE_AGENT_SIGNAL_NAME,
  type ActivityContext,
} from '../activity-executor'
import { handleInvokeAgentJob, isRetryableError } from '../activity-worker-handler'
import type { WorkflowActivityJobInvokeAgent } from '../activity-queue-types'

const tenantId = 'tenant-1'
const organizationId = 'org-1'
const stepId = 'check_policy'

function makeContext(): ActivityContext {
  return {
    workflowInstance: {
      id: 'instance-1',
      tenantId,
      organizationId,
      currentStepId: stepId,
      // executeInvokeAgent resolves the traceable principal from the instance
      // (initiatedBy → definition author); without one it refuses to run.
      metadata: { initiatedBy: 'user-1' },
    } as any,
    workflowContext: {},
    stepContext: { stepId },
    stepInstanceId: 'step-instance-1',
    userId: 'user-1',
  }
}

function makeJob(): WorkflowActivityJobInvokeAgent {
  return {
    kind: 'invoke_agent',
    workflowInstanceId: 'instance-1',
    stepInstanceId: 'step-instance-1',
    stepId,
    signalName: INVOKE_AGENT_SIGNAL_NAME,
    agentId: 'claims.liability.policy_check',
    input: { orderId: 'claim-1' },
    onResult: { autoApproveThreshold: 0 },
    tenantId,
    organizationId,
    userId: 'user-1',
  }
}

beforeEach(() => {
  enqueueMock.mockReset().mockResolvedValue('job-1')
  sendSignalMock.mockReset().mockResolvedValue(undefined)
  completeWorkflowMock.mockReset().mockResolvedValue(undefined)
})

describe('executeInvokeAgent (enqueue + park)', () => {
  it('enqueues an invoke_agent job and parks the step on the proposal-ready signal', async () => {
    const container = { resolve: jest.fn(() => ({})) } as unknown as AwilixContainer

    const result = await executeInvokeAgent(
      { agentId: 'claims.liability.policy_check', input: { orderId: 'claim-1' }, onResult: { autoApproveThreshold: 0 } },
      makeContext(),
      container,
    )

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [job, options] = enqueueMock.mock.calls[0] as [WorkflowActivityJobInvokeAgent, { delayMs?: number }]
    expect(job.kind).toBe('invoke_agent')
    expect(job.stepId).toBe(stepId)
    expect(job.stepInstanceId).toBe('step-instance-1')
    expect(job.agentId).toBe('claims.liability.policy_check')
    expect(job.input).toEqual({ orderId: 'claim-1' })
    expect(job.signalName).toBe(INVOKE_AGENT_SIGNAL_NAME)
    expect(job.userId).toBe('user-1')
    expect(options?.delayMs).toBeGreaterThan(0)

    expect(result).toMatchObject({
      kind: 'pending_agent',
      __park: { signalName: INVOKE_AGENT_SIGNAL_NAME },
    })
  })

  it('fails fast when agent_orchestrator is not installed', async () => {
    const container = { resolve: jest.fn(() => { throw new Error('not registered') }) } as unknown as AwilixContainer
    await expect(
      executeInvokeAgent(
        { agentId: 'a', input: {}, onResult: { autoApproveThreshold: 0 } },
        makeContext(),
        container,
      ),
    ).rejects.toThrow(/agent_orchestrator not installed/)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})

describe('executeInvokeAgent (inline parallel-branch path)', () => {
  function makeBranchContext(): ActivityContext {
    return { ...makeContext(), branchInstanceId: 'branch-1' }
  }

  function makeBranchDeps(outcome: unknown) {
    const invokeAgentForWorkflow = jest.fn().mockResolvedValue(outcome)
    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'agentWorkflowBridge') return { invokeAgentForWorkflow }
        return {}
      }),
    } as unknown as AwilixContainer
    return { container, invokeAgentForWorkflow }
  }

  async function runBranch(outcome: unknown) {
    const { container, invokeAgentForWorkflow } = makeBranchDeps(outcome)
    const result = await executeInvokeAgent(
      { agentId: 'claims.liability.policy_check', input: { orderId: 'claim-1' }, onResult: { autoApproveThreshold: 0 } },
      makeBranchContext(),
      container,
    )
    return { result, invokeAgentForWorkflow }
  }

  it('refuses a suspended outcome: a branch cannot be resumed by an instance-level signal', async () => {
    const { container } = makeBranchDeps({ kind: 'suspended', runId: 'run-9', externalRunId: 'conversation-9' })

    const error = await executeInvokeAgent(
      { agentId: 'claims.voice.callback', input: {}, onResult: { autoApproveThreshold: 0 } },
      makeBranchContext(),
      container,
    ).then(
      () => null,
      (err: unknown) => err,
    )

    expect(error).toBeInstanceOf(AgentSuspensionUnsupportedError)
    const refusal = error as AgentSuspensionUnsupportedError
    expect(refusal.agentId).toBe('claims.voice.callback')
    expect(refusal.runId).toBe('run-9')
    expect(refusal.message).toContain('claims.voice.callback')
    expect(refusal.message).toContain('run-9')
    expect(refusal.message).toContain('out of band')
    expect(refusal.message).toContain('parallel branch')
    // Nothing is enqueued and nothing parks: the branch path is inline.
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('marks the refusal non-retryable for the same check the invoke-agent worker uses', async () => {
    const { container } = makeBranchDeps({ kind: 'suspended', runId: 'run-9' })

    const error = await executeInvokeAgent(
      { agentId: 'claims.voice.callback', input: {}, onResult: { autoApproveThreshold: 0 } },
      makeBranchContext(),
      container,
    ).catch((err: unknown) => err)

    // A queue retry cannot fix an authoring mistake, and retrying would place a
    // second real external run.
    expect(isRetryableError(error)).toBe(false)
  })

  it('still resolves researcher, auto_approved and none_proposed inline', async () => {
    const researcher = await runBranch({ kind: 'researcher', data: { score: 0.9 } })
    expect(researcher.result).toEqual({
      kind: 'researcher',
      agentId: 'claims.liability.policy_check',
      data: { score: 0.9 },
    })

    const autoApproved = await runBranch({ kind: 'auto_approved', proposalId: 'proposal-1', payload: { amount: 10 } })
    expect(autoApproved.result).toEqual({
      kind: 'auto_approved',
      agentId: 'claims.liability.policy_check',
      proposalId: 'proposal-1',
      proposalPayload: { amount: 10 },
    })

    const noneProposed = await runBranch({ kind: 'none_proposed', proposalId: 'proposal-2', payload: null })
    expect(noneProposed.result).toEqual({
      kind: 'none_proposed',
      agentId: 'claims.liability.policy_check',
      proposalId: 'proposal-2',
      proposalPayload: null,
    })
  })

  it('stops the activity retry loop so a refused branch never starts a second external run', async () => {
    const { container, invokeAgentForWorkflow } = makeBranchDeps({ kind: 'suspended', runId: 'run-9' })

    const result = await executeActivity(
      {} as unknown as EntityManager,
      container,
      {
        activityId: 'invoke_voice_agent',
        activityName: 'Invoke voice agent',
        activityType: 'INVOKE_AGENT',
        config: { agentId: 'claims.voice.callback', input: {}, onResult: { autoApproveThreshold: 0 } },
        retryPolicy: { maxAttempts: 3, initialIntervalMs: 0, backoffCoefficient: 1, maxIntervalMs: 0 },
      },
      makeBranchContext(),
    )

    expect(invokeAgentForWorkflow).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(false)
    expect(result.dryRunRefused).toBeUndefined()
    expect(result.error).toContain('parallel branch')
  })

  it('still parks a user_task outcome inline on the proposal-ready signal', async () => {
    const { result } = await runBranch({ kind: 'user_task', proposalId: 'proposal-3' })

    expect(result).toEqual({
      kind: 'user_task',
      agentId: 'claims.liability.policy_check',
      proposalId: 'proposal-3',
      __park: { signalName: INVOKE_AGENT_SIGNAL_NAME },
    })
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})

describe('handleInvokeAgentJob (run agent off-transaction + resume)', () => {
  function makeDeps(instance: Record<string, unknown> | null, outcome?: unknown) {
    const invokeAgentForWorkflow = jest.fn().mockResolvedValue(outcome)
    const em = { findOne: jest.fn().mockResolvedValue(instance) } as unknown as EntityManager
    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'agentWorkflowBridge') return { invokeAgentForWorkflow }
        throw new Error(`unexpected resolve(${name})`)
      }),
    } as unknown as AwilixContainer
    return { em, container, invokeAgentForWorkflow }
  }

  it('skips (idempotent) when the step already advanced', async () => {
    const { em, container, invokeAgentForWorkflow } = makeDeps({
      id: 'instance-1', currentStepId: 'next_step', status: 'RUNNING', tenantId, organizationId,
    })
    await handleInvokeAgentJob(em, container, makeJob())
    expect(invokeAgentForWorkflow).not.toHaveBeenCalled()
    expect(sendSignalMock).not.toHaveBeenCalled()
  })

  it('retries (throws) before running the agent when the step has not parked yet', async () => {
    const { em, container, invokeAgentForWorkflow } = makeDeps({
      id: 'instance-1', currentStepId: stepId, status: 'RUNNING', tenantId, organizationId,
    })
    await expect(handleInvokeAgentJob(em, container, makeJob())).rejects.toThrow(/not parked yet/)
    expect(invokeAgentForWorkflow).not.toHaveBeenCalled()
  })

  it('resumes via signal for a researcher outcome', async () => {
    const { em, container, invokeAgentForWorkflow } = makeDeps(
      { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId },
      { kind: 'researcher', data: { coverage: 'OC' } },
    )
    await handleInvokeAgentJob(em, container, makeJob())
    expect(invokeAgentForWorkflow).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { signalName: string; payload: Record<string, unknown>; agentOutcome: string }]
    expect(options.signalName).toBe(INVOKE_AGENT_SIGNAL_NAME)
    expect(options.agentOutcome).toBe('researcher')
    expect(options.payload.disposition).toBe('researcher')
    expect(options.payload[`${stepId}_agent`]).toEqual({ coverage: 'OC' })
  })

  it('resumes via signal with the proposal payload for an auto_approved outcome', async () => {
    const { em, container } = makeDeps(
      { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId },
      { kind: 'auto_approved', proposalId: 'prop-1', payload: { liabilityFlag: true } },
    )
    await handleInvokeAgentJob(em, container, makeJob())
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { payload: Record<string, unknown> }]
    expect(options.payload.disposition).toBe('auto_approved')
    expect(options.payload.agentProposalId).toBe('prop-1')
    expect(options.payload.proposalPayload).toEqual({ liabilityFlag: true })
  })

  it('keeps outcome routing metadata when outputMapping replaces the visible payload', async () => {
    const { em, container } = makeDeps(
      { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId },
      { kind: 'researcher', data: { coverage: 'OC' } },
    )

    await handleInvokeAgentJob(em, container, {
      ...makeJob(),
      outputMapping: { coverage: 'data.coverage' },
    })

    const [, , options] = sendSignalMock.mock.calls[0] as [
      unknown,
      unknown,
      { payload: Record<string, unknown>; agentOutcome: string },
    ]
    expect(options.payload).toEqual({ coverage: 'OC' })
    expect(options.agentOutcome).toBe('researcher')
  })

  it('hands the bridge the declared outputMapping so a runtime that answers out of band can honour it', async () => {
    const { em, container, invokeAgentForWorkflow } = makeDeps(
      { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId },
      { kind: 'researcher', data: { coverage: 'OC' } },
    )

    await handleInvokeAgentJob(em, container, {
      ...makeJob(),
      outputMapping: { coverage: 'data.coverage' },
    })

    const ctx = (invokeAgentForWorkflow.mock.calls[0][0] as { ctx: Record<string, unknown> }).ctx
    expect(ctx.outputMapping).toEqual({ coverage: 'data.coverage' })
    // The worker still applies the mapping itself for this settled outcome — the
    // ctx field exists only for a runtime that returns BEFORE there is a result.
    const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { payload: unknown }]
    expect(options.payload).toEqual({ coverage: 'OC' })
  })

  it('BC: a step declaring no outputMapping hands the bridge exactly the ctx it always did', async () => {
    const { em, container, invokeAgentForWorkflow } = makeDeps(
      { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId },
      { kind: 'researcher', data: { coverage: 'OC' } },
    )

    await handleInvokeAgentJob(em, container, makeJob())

    // Not `undefined` — ABSENT. The optional fields on this duck-typed ctx are all
    // spread conditionally, and an explicit `undefined` crossing the boundary is
    // the kind of drift nothing on either side type-checks.
    const ctx = (invokeAgentForWorkflow.mock.calls[0][0] as { ctx: Record<string, unknown> }).ctx
    expect(Object.keys(ctx).sort()).toEqual(
      ['organizationId', 'processId', 'stepId', 'tenantId', 'userId'].sort(),
    )
    expect('outputMapping' in ctx).toBe(false)
  })

  it('leaves the step parked for a user_task outcome (human dispose resumes it)', async () => {
    const { em, container } = makeDeps(
      { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId },
      { kind: 'user_task', proposalId: 'prop-2' },
    )
    await handleInvokeAgentJob(em, container, makeJob())
    expect(sendSignalMock).not.toHaveBeenCalled()
  })

  it('leaves the step parked for a suspended outcome (an external run answers out of band)', async () => {
    const instance = { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId }
    const { em, container, invokeAgentForWorkflow } = makeDeps(instance, {
      kind: 'suspended',
      runId: 'run-9',
      externalRunId: 'conversation-9',
    })

    await expect(handleInvokeAgentJob(em, container, makeJob())).resolves.toBeUndefined()

    expect(invokeAgentForWorkflow).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).not.toHaveBeenCalled()
    expect(completeWorkflowMock).not.toHaveBeenCalled()
    expect(instance).toEqual({ id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId })
  })

  it('does not map a suspended outcome into context even when outputMapping is declared', async () => {
    const { em, container } = makeDeps(
      { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId },
      { kind: 'suspended', runId: 'run-10' },
    )

    await handleInvokeAgentJob(em, container, { ...makeJob(), outputMapping: { call: 'data' } })

    expect(sendSignalMock).not.toHaveBeenCalled()
  })

  it('fail-stops the instance (no resume, no rethrow) when the agent run throws', async () => {
    const invokeAgentForWorkflow = jest.fn().mockRejectedValue(new Error('unknown agent id "claims.liability.policy_check"'))
    const em = { findOne: jest.fn().mockResolvedValue({ id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId }) } as unknown as EntityManager
    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'agentWorkflowBridge') return { invokeAgentForWorkflow }
        throw new Error(`unexpected resolve(${name})`)
      }),
    } as unknown as AwilixContainer

    // A missing/erroring agent must NOT resume the workflow and must NOT rethrow
    // (rethrow → endless queue retry of an unwinnable job); it fails the instance.
    await expect(handleInvokeAgentJob(em, container, makeJob())).resolves.toBeUndefined()
    expect(invokeAgentForWorkflow).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).not.toHaveBeenCalled()
    expect(completeWorkflowMock).toHaveBeenCalledTimes(1)
    const [, , instanceId, status] = completeWorkflowMock.mock.calls[0]
    expect(instanceId).toBe('instance-1')
    expect(status).toBe('FAILED')
  })
})
