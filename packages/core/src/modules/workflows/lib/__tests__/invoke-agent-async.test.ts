/**
 * INVOKE_AGENT async execution tests.
 *
 * Covers the fix that runs an INVOKE_AGENT step's agent OUTSIDE the workflow
 * transaction: `executeInvokeAgent` enqueues a job + parks, and the worker's
 * `handleInvokeAgentJob` runs the agent and resumes the parked step.
 */

import { LockMode } from '@mikro-orm/core'
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
  executeInvokeAgent,
  INVOKE_AGENT_SIGNAL_NAME,
  type ActivityContext,
} from '../activity-executor'
import { handleInvokeAgentJob } from '../activity-worker-handler'
import type { WorkflowActivityJobInvokeAgent } from '../activity-queue-types'
import { StepInstance, WorkflowInstance } from '../../data/entities'
import type { StepInstanceStatus } from '../../data/entities'

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

describe('handleInvokeAgentJob (run agent off-transaction + resume)', () => {
  function makeStepAttempt(status: StepInstanceStatus = 'ACTIVE') {
    return { id: 'step-instance-1', workflowInstanceId: 'instance-1', stepId, status }
  }

  function makeDeps(
    instance: Record<string, unknown> | null,
    outcome?: unknown,
    stepAttempt: Record<string, unknown> | null = makeStepAttempt(),
  ) {
    const invokeAgentForWorkflow = jest.fn().mockResolvedValue(outcome)
    const em = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === StepInstance) return stepAttempt
        if (entity === WorkflowInstance) return instance
        return null
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

  it('skips (idempotent) when this step attempt already resolved', async () => {
    const { em, container, invokeAgentForWorkflow } = makeDeps(
      { id: 'instance-1', currentStepId: 'next_step', status: 'RUNNING', tenantId, organizationId },
      undefined,
      makeStepAttempt('COMPLETED'),
    )
    await handleInvokeAgentJob(em, container, makeJob())
    expect(invokeAgentForWorkflow).not.toHaveBeenCalled()
    expect(sendSignalMock).not.toHaveBeenCalled()
  })

  it('still skips a duplicate delivery when a loop re-entered the SAME step id under a new attempt', async () => {
    // `currentStepId` is back on this step (a new attempt is parked there), so an
    // equality check on it would happily re-run the agent for the OLD attempt.
    const { em, container, invokeAgentForWorkflow } = makeDeps(
      { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId },
      { kind: 'researcher', data: {} },
      makeStepAttempt('COMPLETED'),
    )
    await handleInvokeAgentJob(em, container, makeJob())
    expect(invokeAgentForWorkflow).not.toHaveBeenCalled()
    expect(sendSignalMock).not.toHaveBeenCalled()
  })

  it('re-delivers (throws) instead of dropping when the instance has not reached the step yet', async () => {
    // Issue #5986: the job was picked up before the parking transaction became
    // visible — the instance still reads as the PREVIOUS step and the attempt row
    // does not exist yet. Dropping the job here parks the instance forever.
    const { em, container, invokeAgentForWorkflow } = makeDeps(
      { id: 'instance-1', currentStepId: 'start', status: 'RUNNING', tenantId, organizationId },
      undefined,
      null,
    )
    await expect(handleInvokeAgentJob(em, container, makeJob())).rejects.toThrow(/not visible yet/)
    expect(invokeAgentForWorkflow).not.toHaveBeenCalled()
    expect(sendSignalMock).not.toHaveBeenCalled()
  })

  it('waits for the parking transaction to commit before deciding (issue #5986)', async () => {
    // The barrier takes the same PESSIMISTIC_WRITE lock on the instance row that
    // the executor holds for the length of its transaction, so the guard below
    // never reads a pre-commit snapshot.
    let parkingCommitted = false
    const lockModes: unknown[] = []
    const invokeAgentForWorkflow = jest.fn().mockResolvedValue({ kind: 'researcher', data: { coverage: 'OC' } })
    const em = {
      isInTransaction: () => false,
      transactional: jest.fn(async (callback: (trx: EntityManager) => Promise<unknown>) => {
        const trx = {
          findOne: jest.fn(async (_entity: unknown, _where: unknown, options?: { lockMode?: unknown }) => {
            lockModes.push(options?.lockMode)
            parkingCommitted = true
            return { id: 'instance-1' }
          }),
        } as unknown as EntityManager
        return await callback(trx)
      }),
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === StepInstance) return parkingCommitted ? makeStepAttempt() : null
        return parkingCommitted
          ? { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId }
          : { id: 'instance-1', currentStepId: 'start', status: 'RUNNING', tenantId, organizationId }
      }),
    } as unknown as EntityManager
    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'agentWorkflowBridge') return { invokeAgentForWorkflow }
        throw new Error(`unexpected resolve(${name})`)
      }),
    } as unknown as AwilixContainer

    await handleInvokeAgentJob(em, container, makeJob())

    expect(lockModes).toEqual([LockMode.PESSIMISTIC_WRITE])
    expect(invokeAgentForWorkflow).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
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

  it('leaves the step parked for a user_task outcome (human dispose resumes it)', async () => {
    const { em, container } = makeDeps(
      { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId },
      { kind: 'user_task', proposalId: 'prop-2' },
    )
    await handleInvokeAgentJob(em, container, makeJob())
    expect(sendSignalMock).not.toHaveBeenCalled()
  })

  it('fail-stops the instance (no resume, no rethrow) when the agent run throws', async () => {
    const invokeAgentForWorkflow = jest.fn().mockRejectedValue(new Error('unknown agent id "claims.liability.policy_check"'))
    const em = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === StepInstance) return makeStepAttempt()
        return { id: 'instance-1', currentStepId: stepId, status: 'PAUSED', tenantId, organizationId }
      }),
      flush: jest.fn(),
    } as unknown as EntityManager
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
