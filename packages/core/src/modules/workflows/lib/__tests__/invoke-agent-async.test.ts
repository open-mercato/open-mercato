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

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(() => ({ enqueue: enqueueMock })),
}))

jest.mock('../signal-handler', () => ({
  sendSignal: (...args: unknown[]) => sendSignalMock(args[0], args[1], args[2]),
}))

import {
  executeInvokeAgent,
  INVOKE_AGENT_SIGNAL_NAME,
  type ActivityContext,
} from '../activity-executor'
import { handleInvokeAgentJob } from '../activity-worker-handler'
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
      // The agent run executes under the user who initiated the instance
      // (resolveWorkflowPrincipalUserId); without it the executor refuses to run.
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
    input: { claimId: 'claim-1' },
    onResult: { autoApproveThreshold: 0 },
    tenantId,
    organizationId,
    userId: 'user-1',
  }
}

beforeEach(() => {
  enqueueMock.mockReset().mockResolvedValue('job-1')
  sendSignalMock.mockReset().mockResolvedValue(undefined)
})

describe('executeInvokeAgent (enqueue + park)', () => {
  it('enqueues an invoke_agent job and parks the step on the proposal-ready signal', async () => {
    const container = { resolve: jest.fn(() => ({})) } as unknown as AwilixContainer

    const result = await executeInvokeAgent(
      { agentId: 'claims.liability.policy_check', input: { claimId: 'claim-1' }, onResult: { autoApproveThreshold: 0 } },
      makeContext(),
      container,
    )

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [job, options] = enqueueMock.mock.calls[0] as [WorkflowActivityJobInvokeAgent, { delayMs?: number }]
    expect(job.kind).toBe('invoke_agent')
    expect(job.stepId).toBe(stepId)
    expect(job.stepInstanceId).toBe('step-instance-1')
    expect(job.agentId).toBe('claims.liability.policy_check')
    expect(job.input).toEqual({ claimId: 'claim-1' })
    expect(job.signalName).toBe(INVOKE_AGENT_SIGNAL_NAME)
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

  it('resumes via signal for an informative outcome', async () => {
    const { em, container, invokeAgentForWorkflow } = makeDeps(
      { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId },
      { kind: 'informative', data: { coverage: 'OC' } },
    )
    await handleInvokeAgentJob(em, container, makeJob())
    expect(invokeAgentForWorkflow).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { signalName: string; payload: Record<string, unknown> }]
    expect(options.signalName).toBe(INVOKE_AGENT_SIGNAL_NAME)
    expect(options.payload.disposition).toBe('informative')
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

  it('leaves the step parked for a user_task outcome (human dispose resumes it)', async () => {
    const { em, container } = makeDeps(
      { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId },
      { kind: 'user_task', proposalId: 'prop-2' },
    )
    await handleInvokeAgentJob(em, container, makeJob())
    expect(sendSignalMock).not.toHaveBeenCalled()
  })
})
