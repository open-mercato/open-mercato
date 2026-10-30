import { beforeEach, describe, expect, jest, test } from '@jest/globals'

const recomputeFromEvent = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const enqueueForFinishedProcess = jest.fn<(...args: unknown[]) => Promise<boolean>>()

jest.mock('../lib/processes/processProjection', () => ({
  recomputeFromEvent: (...args: unknown[]) => recomputeFromEvent(...args),
}))

jest.mock('../lib/trace/otel/exportJob', () => ({
  enqueueOtelExportForFinishedProcess: (...args: unknown[]) => enqueueForFinishedProcess(...args),
}))

jest.mock('../lib/queue', () => ({
  AGENT_ORCHESTRATOR_OTEL_EXPORT_QUEUE: 'agent-orchestrator-otel-export',
  getAgentOrchestratorQueue: () => ({ enqueue: jest.fn() }),
}))

jest.mock('../data/entities', () => ({ AgentRun: class AgentRun {} }))

import completedHandler from '../subscribers/process-workflow-completed'
import failedHandler from '../subscribers/process-workflow-failed'
import cancelledHandler from '../subscribers/process-workflow-cancelled'
import { findLatestTopLevelRunId } from '../lib/trace/otel/finishedProcessExport'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const WORKFLOW_INSTANCE_ID = '55555555-5555-4555-8555-555555555555'
const RUN_ID = '33333333-3333-4333-8333-333333333333'

const event = { id: WORKFLOW_INSTANCE_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

function makeCtx() {
  const em = { fork: () => em, findOne: jest.fn() }
  return { em, ctx: { resolve: <T = unknown>(_name: string) => em as unknown as T } }
}

beforeEach(() => {
  recomputeFromEvent.mockReset()
  enqueueForFinishedProcess.mockReset()
  enqueueForFinishedProcess.mockResolvedValue(true)
})

describe('terminal workflow subscribers trigger the workflow-root export', () => {
  test.each([
    ['completed', completedHandler, 'completed'],
    ['failed', failedHandler, 'failed'],
    ['cancelled', cancelledHandler, 'cancelled'],
  ])('%s: enqueues after the projection is terminal, with the event scope', async (_label, handler, status) => {
    recomputeFromEvent.mockResolvedValue({ executionId: 'execution-1', status })
    const { ctx } = makeCtx()
    await handler(event, ctx)
    expect(recomputeFromEvent).toHaveBeenCalledTimes(1)
    expect(enqueueForFinishedProcess).toHaveBeenCalledTimes(1)
    const [payload] = enqueueForFinishedProcess.mock.calls[0]
    expect(payload).toEqual(expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID }))
    expect(recomputeFromEvent.mock.invocationCallOrder[0]).toBeLessThan(enqueueForFinishedProcess.mock.invocationCallOrder[0])
  })

  test.each([
    ['completed', completedHandler],
    ['failed', failedHandler],
    ['cancelled', cancelledHandler],
  ])('%s: no export when the execution has no projection row', async (_label, handler) => {
    recomputeFromEvent.mockResolvedValue(null)
    const { ctx } = makeCtx()
    await handler(event, ctx)
    expect(enqueueForFinishedProcess).not.toHaveBeenCalled()
  })
})

describe('findLatestTopLevelRunId', () => {
  test('scopes to tenant, organization and execution, top-level and exportable runs, newest first', async () => {
    const findOne = jest.fn(async (..._args: unknown[]) => ({ id: RUN_ID }))
    const em = { findOne } as unknown as Parameters<typeof findLatestTopLevelRunId>[0]
    const runId = await findLatestTopLevelRunId(em, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      workflowInstanceId: WORKFLOW_INSTANCE_ID,
      sources: ['runtime'],
      agentAllowlist: ['sales.quote_drafter'],
    })
    expect(runId).toBe(RUN_ID)
    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        workflowInstanceId: WORKFLOW_INSTANCE_ID,
        parentRunId: null,
        deletedAt: null,
        source: { $in: ['runtime'] },
        agentId: { $in: ['sales.quote_drafter'] },
      },
      { orderBy: { createdAt: 'desc' }, fields: ['id'] },
    )
  })

  test('omits the agent filter without an allowlist and returns null when nothing matches', async () => {
    const findOne = jest.fn(async (..._args: unknown[]) => null)
    const em = { findOne } as unknown as Parameters<typeof findLatestTopLevelRunId>[0]
    const runId = await findLatestTopLevelRunId(em, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      workflowInstanceId: WORKFLOW_INSTANCE_ID,
      sources: ['runtime', 'eval'],
      agentAllowlist: null,
    })
    expect(runId).toBeNull()
    const [, where] = findOne.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(where).not.toHaveProperty('agentId')
  })
})
