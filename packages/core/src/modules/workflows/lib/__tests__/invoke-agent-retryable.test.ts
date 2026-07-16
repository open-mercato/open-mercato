/**
 * INVOKE_AGENT retryable-error classification tests.
 *
 * A transient capacity rejection from the agent runtime carries a structural
 * `retryable: true` marker (core cannot import the enterprise error class).
 * `handleInvokeAgentJob` must RETHROW it so the queue's retry/backoff handles
 * it, while every other agent error keeps the existing fail-stop path.
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

import { handleInvokeAgentJob } from '../activity-worker-handler'
import { INVOKE_AGENT_SIGNAL_NAME } from '../activity-executor'
import type { WorkflowActivityJobInvokeAgent } from '../activity-queue-types'

const tenantId = 'tenant-1'
const organizationId = 'org-1'
const stepId = 'check_policy'

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

function makeDeps(agentError: unknown) {
  const invokeAgentForWorkflow = jest.fn().mockRejectedValue(agentError)
  const em = {
    findOne: jest.fn().mockResolvedValue({
      id: 'instance-1',
      currentStepId: stepId,
      status: 'PAUSED',
      tenantId,
      organizationId,
    }),
  } as unknown as EntityManager
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'agentWorkflowBridge') return { invokeAgentForWorkflow }
      throw new Error(`unexpected resolve(${name})`)
    }),
  } as unknown as AwilixContainer
  return { em, container, invokeAgentForWorkflow }
}

beforeEach(() => {
  sendSignalMock.mockReset().mockResolvedValue(undefined)
  completeWorkflowMock.mockReset().mockResolvedValue(undefined)
})

describe('handleInvokeAgentJob retryable-error classification', () => {
  it('rethrows a structurally retryable error (retryable: true) for queue-level retry', async () => {
    const capacityError = Object.assign(new Error('[internal] agent run admission rejected: queue full'), {
      name: 'AgentCapacityError',
      retryable: true,
    })
    const { em, container, invokeAgentForWorkflow } = makeDeps(capacityError)

    await expect(handleInvokeAgentJob(em, container, makeJob())).rejects.toBe(capacityError)

    expect(invokeAgentForWorkflow).toHaveBeenCalledTimes(1)
    // No fail-stop and no resume: the queue owns the retry.
    expect(completeWorkflowMock).not.toHaveBeenCalled()
    expect(sendSignalMock).not.toHaveBeenCalled()
  })

  it('keeps the fail-stop path (no rethrow) for a plain non-retryable Error', async () => {
    const { em, container, invokeAgentForWorkflow } = makeDeps(
      new Error('unknown agent id "claims.liability.policy_check"'),
    )

    await expect(handleInvokeAgentJob(em, container, makeJob())).resolves.toBeUndefined()

    expect(invokeAgentForWorkflow).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).not.toHaveBeenCalled()
    expect(completeWorkflowMock).toHaveBeenCalledTimes(1)
    const [, , instanceId, status] = completeWorkflowMock.mock.calls[0]
    expect(instanceId).toBe('instance-1')
    expect(status).toBe('FAILED')
  })

  it('does not treat retryable: false (or a missing marker) as retryable', async () => {
    const nonRetryable = Object.assign(new Error('agent failed'), { retryable: false })
    const { em, container } = makeDeps(nonRetryable)

    await expect(handleInvokeAgentJob(em, container, makeJob())).resolves.toBeUndefined()
    expect(completeWorkflowMock).toHaveBeenCalledTimes(1)
  })
})
