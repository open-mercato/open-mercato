/**
 * GHSA-429h-x9x8-rv2m + GHSA-xch5-xj47-xcxm — the trace-ingest write path must
 * not let an unsigned organization header or an unvalidated payload reference
 * widen the HMAC-verified tenant scope:
 *
 * - the ingest organization must belong to the verified tenant (uniform 401),
 * - a workflowInstanceId must resolve to an instance in the same tenant+org,
 * - confidence is bounded 0-1, costMinor has an upper limit, and a stepId
 *   never travels without its workflowInstanceId.
 */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { traceIngestSchema, TRACE_INGEST_MAX_COST_MINOR } from '../data/validators'
import { assertTraceIngestScope } from '../lib/trace/ingestScope'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'

jest.mock('../lib/trace/traceIngestionService', () => ({
  ingestTrace: jest.fn(async () => ({ runId: 'run-1', created: true, spansAppended: 0, toolCallsAppended: 0 })),
}))
jest.mock('../lib/trace/artifactStore', () => ({
  createArtifactResultOffloader: () => undefined,
}))
jest.mock('../lib/trace/ingestContentCapture', () => ({
  resolveIngestContentCapture: async () => ({}),
}))
jest.mock('../lib/eval/evalRuntimeService', () => ({
  evaluateRun: jest.fn(async () => ({ scored: 0, evaluated: 0, evalPassed: null, evalScore: null })),
}))
jest.mock('../lib/crudCache', () => ({
  invalidateAgentRunCache: jest.fn(async () => undefined),
}))
jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => undefined),
}))
jest.mock('../lib/queue', () => ({
  AGENT_ORCHESTRATOR_LLM_JUDGE_QUEUE: 'agent-orchestrator-llm-judge',
  getAgentOrchestratorQueue: () => ({ enqueue: jest.fn(async () => undefined) }),
}))

import '../commands/trace'
import { ingestTrace } from '../lib/trace/traceIngestionService'

const tenantId = '11111111-1111-1111-1111-111111111111'
const organizationId = '22222222-2222-2222-2222-222222222222'
const foreignOrganizationId = '33333333-3333-3333-3333-333333333333'
const foreignTenantId = '44444444-4444-4444-4444-444444444444'
const workflowInstanceId = '55555555-5555-5555-5555-555555555555'

type OrganizationFixture = { id: string }

function makeEm(organization: OrganizationFixture | null) {
  return {
    fork: () => em,
    findOne: jest.fn(async (entity: unknown, filter: Record<string, unknown>) => {
      if (entity === Organization) {
        organizationQueries.push(filter)
        return organization
      }
      return { id: (filter as { id?: string }).id ?? 'run-1', workflowInstanceId: null }
    }),
    count: jest.fn(async () => 0),
  } as unknown as EntityManager & { fork: () => EntityManager }
}

const organizationQueries: Array<Record<string, unknown>> = []

function makeContainer(em: EntityManager, workflowExecutor: unknown) {
  return {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'workflowExecutor') {
        if (workflowExecutor === undefined) throw new Error('[internal] dependency not found')
        return workflowExecutor
      }
      throw new Error(`[internal] Unexpected dependency ${name}`)
    },
  }
}

function makeReader(instance: { tenantId: string; organizationId: string } | null) {
  return {
    getWorkflowInstance: jest.fn(async () => instance),
  }
}

const inScopeInstance = { tenantId, organizationId }

describe('traceIngestSchema bounds (GHSA-xch5)', () => {
  const base = { runtime: 'opencode', externalRunId: 'run-1', agentId: 'agent-1' }

  it('accepts confidence inside 0-1 and rejects values outside', () => {
    for (const confidence of [0, 0.5, 1]) {
      expect(traceIngestSchema.safeParse({ ...base, confidence }).success).toBe(true)
    }
    for (const confidence of [-0.01, 1.01, 1000]) {
      expect(traceIngestSchema.safeParse({ ...base, confidence }).success).toBe(false)
    }
  })

  it('bounds costMinor at TRACE_INGEST_MAX_COST_MINOR minor units', () => {
    expect(TRACE_INGEST_MAX_COST_MINOR).toBeGreaterThan(0)
    expect(traceIngestSchema.safeParse({ ...base, costMinor: TRACE_INGEST_MAX_COST_MINOR }).success).toBe(true)
    expect(traceIngestSchema.safeParse({ ...base, costMinor: TRACE_INGEST_MAX_COST_MINOR + 1 }).success).toBe(false)
    expect(traceIngestSchema.safeParse({ ...base, costMinor: -1 }).success).toBe(false)
  })

  it('rejects a stepId without its workflowInstanceId and accepts the pair', () => {
    expect(traceIngestSchema.safeParse({ ...base, stepId: 'review' }).success).toBe(false)
    expect(traceIngestSchema.safeParse({ ...base, workflowInstanceId, stepId: 'review' }).success).toBe(true)
    expect(traceIngestSchema.safeParse({ ...base, workflowInstanceId }).success).toBe(true)
    expect(traceIngestSchema.safeParse({ ...base, workflowInstanceId: null, stepId: null }).success).toBe(true)
  })
})

describe('assertTraceIngestScope', () => {
  beforeEach(() => {
    organizationQueries.length = 0
  })

  it('rejects an organization outside the verified tenant with the uniform 401', async () => {
    const em = makeEm(null)
    await expect(
      assertTraceIngestScope(em, makeContainer(em, undefined), { tenantId, organizationId }, {}),
    ).rejects.toMatchObject({
      status: 401,
      body: { error: 'Trace ingest verification failed' },
    })
    expect(organizationQueries).toEqual([{ id: organizationId, tenant: tenantId, deletedAt: null }])
  })

  it('accepts an organization of the verified tenant and skips instance checks without a reference', async () => {
    const em = makeEm({ id: organizationId })
    const reader = makeReader(inScopeInstance)
    await expect(
      assertTraceIngestScope(em, makeContainer(em, reader), { tenantId, organizationId }, {}),
    ).resolves.toBeUndefined()
    expect(reader.getWorkflowInstance).not.toHaveBeenCalled()
  })

  it('accepts a workflow instance in the same tenant and organization', async () => {
    const em = makeEm({ id: organizationId })
    const reader = makeReader(inScopeInstance)
    await expect(
      assertTraceIngestScope(em, makeContainer(em, reader), { tenantId, organizationId }, { workflowInstanceId }),
    ).resolves.toBeUndefined()
    expect(reader.getWorkflowInstance).toHaveBeenCalledWith(em, workflowInstanceId)
  })

  it.each([
    ['another tenant', { tenantId: foreignTenantId, organizationId }],
    ['another organization of the same tenant', { tenantId, organizationId: foreignOrganizationId }],
    ['no instance at all', null],
  ])('rejects a workflow instance pointing to %s with 422', async (_label, instance) => {
    const em = makeEm({ id: organizationId })
    const reader = makeReader(instance as { tenantId: string; organizationId: string } | null)
    await expect(
      assertTraceIngestScope(em, makeContainer(em, reader), { tenantId, organizationId }, { workflowInstanceId }),
    ).rejects.toMatchObject({
      status: 422,
      body: { error: 'Invalid trace payload', code: 'workflow_instance_out_of_scope' },
    })
  })

  it('skips the instance check when the workflows peer is not installed', async () => {
    const em = makeEm({ id: organizationId })
    await expect(
      assertTraceIngestScope(em, makeContainer(em, undefined), { tenantId, organizationId }, { workflowInstanceId }),
    ).resolves.toBeUndefined()
  })
})

describe('agent_orchestrator.trace.ingest command wiring', () => {
  beforeEach(() => {
    organizationQueries.length = 0
    jest.clearAllMocks()
  })

  async function executeIngest(options: {
    organization: OrganizationFixture | null
    workflowExecutor: unknown
    payload: Record<string, unknown>
  }) {
    const em = makeEm(options.organization)
    const container = makeContainer(em, options.workflowExecutor)
    return new CommandBus().execute('agent_orchestrator.trace.ingest', {
      input: { tenantId, organizationId, payload: options.payload },
      ctx: {
        container,
        auth: null,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: [organizationId],
        systemActor: true,
      },
    })
  }

  it('ingests a trace for an organization of the verified tenant', async () => {
    const payload = { runtime: 'opencode', externalRunId: 'run-1', agentId: 'agent-1' }
    const { result } = await executeIngest({
      organization: { id: organizationId },
      workflowExecutor: makeReader(inScopeInstance),
      payload,
    })
    expect(result.runId).toBe('run-1')
    expect(ingestTrace).toHaveBeenCalledTimes(1)
  })

  it('refuses to ingest under an organization outside the verified tenant before any write', async () => {
    await expect(
      executeIngest({
        organization: null,
        workflowExecutor: makeReader(inScopeInstance),
        payload: { runtime: 'opencode', externalRunId: 'run-1', agentId: 'agent-1' },
      }),
    ).rejects.toBeInstanceOf(CrudHttpError)
    expect(ingestTrace).not.toHaveBeenCalled()
  })

  it('refuses to ingest a trace that injects cost into a foreign workflow instance', async () => {
    await expect(
      executeIngest({
        organization: { id: organizationId },
        workflowExecutor: makeReader({ tenantId, organizationId: foreignOrganizationId }),
        payload: {
          runtime: 'opencode',
          externalRunId: 'run-1',
          agentId: 'agent-1',
          workflowInstanceId,
          costMinor: 40,
        },
      }),
    ).rejects.toMatchObject({ status: 422 })
    expect(ingestTrace).not.toHaveBeenCalled()
  })
})
