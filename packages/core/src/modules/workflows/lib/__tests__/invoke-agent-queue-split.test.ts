/**
 * INVOKE_AGENT queue-split tests (performance hardening Phase 1).
 *
 * Covers the dedicated 'workflow-invoke-agent' queue: `executeInvokeAgent`
 * enqueues there (not on 'workflow-activities'), the new dedicated worker
 * delegates invoke_agent jobs to `handleInvokeAgentJob`, and the old
 * workflow-activities worker keeps a drain bridge for pre-cutover jobs.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { QueuedJob, JobContext } from '@open-mercato/queue'

const enqueueMocksByQueueName = new Map<string, jest.Mock>()
const createModuleQueueMock = jest.fn((name: string) => {
  let enqueue = enqueueMocksByQueueName.get(name)
  if (!enqueue) {
    enqueue = jest.fn().mockResolvedValue(`job-${name}`)
    enqueueMocksByQueueName.set(name, enqueue)
  }
  return { enqueue }
})

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: (name: string, options?: { concurrency?: number }) =>
    createModuleQueueMock(name, options),
}))

const handleInvokeAgentJobMock = jest.fn<Promise<void>, [unknown, unknown, unknown]>()

jest.mock('../activity-worker-handler', () => ({
  handleInvokeAgentJob: (...args: unknown[]) =>
    handleInvokeAgentJobMock(args[0], args[1], args[2]),
  resumeParentAfterSubWorkflow: jest.fn(),
}))

import {
  executeInvokeAgent,
  INVOKE_AGENT_SIGNAL_NAME,
  type ActivityContext,
} from '../activity-executor'
import {
  WORKFLOW_ACTIVITIES_QUEUE_NAME,
  WORKFLOW_INVOKE_AGENT_QUEUE_NAME,
  type WorkflowActivityJob,
  type WorkflowActivityJobInvokeAgent,
} from '../activity-queue-types'
import invokeAgentWorkerHandle, {
  metadata as invokeAgentWorkerMetadata,
} from '../../workers/workflow-invoke-agent.worker'
import activitiesWorkerHandle from '../../workers/workflow-activities.worker'

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
      metadata: { initiatedBy: 'user-1' },
    } as any,
    workflowContext: {},
    stepContext: { stepId },
    stepInstanceId: 'step-instance-1',
    userId: 'user-1',
  }
}

function makeInvokeAgentPayload(): WorkflowActivityJobInvokeAgent {
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

function makeQueuedJob(payload: WorkflowActivityJob): QueuedJob<WorkflowActivityJob> {
  return { id: 'queued-job-1', payload, createdAt: new Date().toISOString() }
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

function makeWorkerCtx(queueName: string): { ctx: HandlerContext; em: EntityManager } {
  const em = { findOne: jest.fn() } as unknown as EntityManager
  const ctx = {
    jobId: 'queued-job-1',
    attemptNumber: 1,
    queueName,
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      throw new Error(`unexpected resolve(${name})`)
    }),
  } as unknown as HandlerContext
  return { ctx, em }
}

beforeEach(() => {
  for (const enqueue of enqueueMocksByQueueName.values()) enqueue.mockClear()
  handleInvokeAgentJobMock.mockReset().mockResolvedValue(undefined)
})

describe('executeInvokeAgent queue routing', () => {
  it('enqueues to the dedicated workflow-invoke-agent queue and still parks the step', async () => {
    const container = { resolve: jest.fn(() => ({})) } as unknown as AwilixContainer

    const result = await executeInvokeAgent(
      { agentId: 'claims.liability.policy_check', input: { claimId: 'claim-1' }, onResult: { autoApproveThreshold: 0 } },
      makeContext(),
      container,
    )

    const createdQueueNames = createModuleQueueMock.mock.calls.map(([name]) => name)
    expect(createdQueueNames).toContain(WORKFLOW_INVOKE_AGENT_QUEUE_NAME)

    const invokeAgentEnqueue = enqueueMocksByQueueName.get(WORKFLOW_INVOKE_AGENT_QUEUE_NAME)
    expect(invokeAgentEnqueue).toBeDefined()
    expect(invokeAgentEnqueue).toHaveBeenCalledTimes(1)
    const [job] = invokeAgentEnqueue!.mock.calls[0] as [WorkflowActivityJobInvokeAgent]
    expect(job.kind).toBe('invoke_agent')
    expect(job.agentId).toBe('claims.liability.policy_check')
    expect(job.signalName).toBe(INVOKE_AGENT_SIGNAL_NAME)

    const activitiesEnqueue = enqueueMocksByQueueName.get(WORKFLOW_ACTIVITIES_QUEUE_NAME)
    if (activitiesEnqueue) expect(activitiesEnqueue).not.toHaveBeenCalled()

    expect(result).toMatchObject({
      kind: 'pending_agent',
      __park: { signalName: INVOKE_AGENT_SIGNAL_NAME },
    })
  })
})

describe('workflow-invoke-agent worker', () => {
  it('declares the dedicated queue in its metadata', () => {
    expect(invokeAgentWorkerMetadata.queue).toBe(WORKFLOW_INVOKE_AGENT_QUEUE_NAME)
    expect(invokeAgentWorkerMetadata.id).toBe('workflows:workflow-invoke-agent')
  })

  it('delegates invoke_agent jobs to handleInvokeAgentJob', async () => {
    const payload = makeInvokeAgentPayload()
    const { ctx, em } = makeWorkerCtx(WORKFLOW_INVOKE_AGENT_QUEUE_NAME)

    await invokeAgentWorkerHandle(makeQueuedJob(payload), ctx)

    expect(handleInvokeAgentJobMock).toHaveBeenCalledTimes(1)
    const [passedEm, , passedPayload] = handleInvokeAgentJobMock.mock.calls[0]
    expect(passedEm).toBe(em)
    expect(passedPayload).toBe(payload)
  })

  it('warns and skips (no throw) on a non-invoke_agent job kind', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const timerPayload: WorkflowActivityJob = {
      kind: 'timer',
      workflowInstanceId: 'instance-1',
      stepInstanceId: 'step-instance-1',
      tenantId,
      organizationId,
      fireAt: new Date().toISOString(),
    }
    const { ctx } = makeWorkerCtx(WORKFLOW_INVOKE_AGENT_QUEUE_NAME)

    await expect(invokeAgentWorkerHandle(makeQueuedJob(timerPayload), ctx)).resolves.toBeUndefined()

    expect(handleInvokeAgentJobMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('unexpected kind')
    warnSpy.mockRestore()
  })
})

describe('workflow-activities worker drain bridge', () => {
  it('still routes invoke_agent jobs to handleInvokeAgentJob', async () => {
    const payload = makeInvokeAgentPayload()
    const { ctx, em } = makeWorkerCtx(WORKFLOW_ACTIVITIES_QUEUE_NAME)

    await activitiesWorkerHandle(makeQueuedJob(payload), ctx)

    expect(handleInvokeAgentJobMock).toHaveBeenCalledTimes(1)
    const [passedEm, , passedPayload] = handleInvokeAgentJobMock.mock.calls[0]
    expect(passedEm).toBe(em)
    expect(passedPayload).toBe(payload)
  })
})
