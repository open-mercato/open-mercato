import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { traceIngestSchema, TRACE_INGEST_MAX_COST_MINOR } from '../data/validators'
import { assertTraceIngestOrganization, assertTraceIngestRun } from '../lib/trace/ingestScope'
import { withTraceIngestAuthority } from '../lib/trace/ingestAuthority'
import { AgentRun } from '../data/entities'
import type { IngestScope, IngestTraceOptions } from '../lib/trace/traceIngestionService'
import { CommandBus, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'

jest.mock('../lib/trace/traceIngestionService', () => ({
  ingestTrace: jest.fn(async (
    em: EntityManager, _scope: IngestScope, _payload: unknown, options: IngestTraceOptions,
  ) => {
    await options.assertRunScope?.(await em.findOne(AgentRun, {}))
    return { runId: 'run-1', created: true, spansAppended: 0, toolCallsAppended: 0 }
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: EntityManager, entity: typeof Organization, filter: { id: string }) => em.findOne(entity, filter),
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

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const workflowInstanceId = '55555555-5555-4555-8555-555555555555'
const invocationId = '66666666-6666-4666-8666-666666666666'

type OrganizationFixture = { id: string }

function makeEm(organization: OrganizationFixture | null, run: RunFixture | null = null) {
  const em = {
    findOne: jest.fn(async (entity: unknown, filter: Record<string, unknown>) => {
      if (entity === Organization) {
        organizationQueries.push(filter)
        return organization
      }
      return run
    }),
    count: jest.fn(async () => 0),
  }
  return Object.assign(em, { fork: () => em }) as unknown as EntityManager & { fork: () => EntityManager }
}

const organizationQueries: Array<Record<string, unknown>> = []

function makeContainer(em: EntityManager, workflowExecutor?: unknown) {
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

function makeReader(result = true) {
  return { hasWorkflowStepReference: jest.fn(async () => result) }
}

type RunFixture = Pick<AgentRun, 'id' | 'agentId' | 'deletedAt' | 'workflowInstanceId' | 'stepId' | 'invocationId'>

const scope = { tenantId, organizationId }
const agentId = 'agent-1'
const linkedRun: RunFixture = { id: 'run-1', agentId, workflowInstanceId, stepId: 'review', invocationId }

describe('traceIngestSchema bounds', () => {
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

describe('trace ingest authorization', () => {
  beforeEach(() => {
    organizationQueries.length = 0
  })

  it('checks the organization belongs to the authenticated tenant', async () => {
    await expect(assertTraceIngestOrganization(makeEm(null), scope)).rejects.toMatchObject({
      status: 401,
      body: { error: 'Trace ingest verification failed' },
    })
    expect(organizationQueries).toEqual([{ id: organizationId, tenant: tenantId, deletedAt: null }])
    await expect(assertTraceIngestOrganization(makeEm({ id: organizationId }), scope)).resolves.toBeUndefined()
  })

  it('allows standalone traces when workflows is unavailable', async () => {
    const em = makeEm({ id: organizationId })
    await expect(assertTraceIngestRun(em, makeContainer(em), scope, { agentId }, null)).resolves.toBeUndefined()
  })

  it('validates the persisted workflow step even when the adapter omits correlation fields', async () => {
    const em = makeEm({ id: organizationId })
    const reader = makeReader()
    await expect(assertTraceIngestRun(em, makeContainer(em, reader), scope, { agentId }, linkedRun))
      .resolves.toBeUndefined()
    expect(reader.hasWorkflowStepReference).toHaveBeenCalledWith(em, scope, workflowInstanceId, 'review', invocationId)
  })

  it.each([
    { label: 'different agent', payload: { agentId: 'agent-2' }, run: linkedRun },
    { label: 'different step', payload: { agentId, workflowInstanceId, stepId: 'other-step' }, run: linkedRun },
    { label: 'cleared workflow', payload: { agentId, workflowInstanceId: null }, run: linkedRun },
    { label: 'new run with workflow claims', payload: { agentId, workflowInstanceId }, run: null },
    { label: 'unverified invocation', payload: { agentId }, run: { ...linkedRun, invocationId: null } },
  ])('rejects inconsistent correlation for $label', async ({ payload, run }) => {
    const em = makeEm({ id: organizationId })
    const reader = makeReader()
    await expect(assertTraceIngestRun(em, makeContainer(em, reader), scope, payload, run))
      .rejects.toMatchObject({ status: 422 })
    expect(reader.hasWorkflowStepReference).not.toHaveBeenCalled()
  })

  it('rejects a persisted workflow step absent from the authenticated scope', async () => {
    const em = makeEm({ id: organizationId })
    const reader = makeReader(false)
    await expect(assertTraceIngestRun(em, makeContainer(em, reader), scope, { agentId }, linkedRun))
      .rejects.toMatchObject({ status: 422 })
  })

  it('rejects a workflow-linked trace when the needed workflows reader is unavailable', async () => {
    const em = makeEm({ id: organizationId })
    await expect(assertTraceIngestRun(em, makeContainer(em), scope, { agentId }, linkedRun))
      .rejects.toMatchObject({ status: 422 })
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
    run?: RunFixture
    authority?: Parameters<typeof withTraceIngestAuthority>[1]
    systemActor?: boolean
  }) {
    const em = makeEm(options.organization, options.run)
    const container = makeContainer(em, options.workflowExecutor) as unknown as CommandRuntimeContext['container']
    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      systemActor: options.systemActor,
    }
    return new CommandBus().execute('agent_orchestrator.trace.ingest', {
      input: { tenantId, organizationId, payload: options.payload },
      ctx: options.authority ? withTraceIngestAuthority(ctx, options.authority) : ctx,
    })
  }

  it('ingests a trace for an organization of the verified tenant', async () => {
    const payload = { runtime: 'opencode', externalRunId: 'run-1', agentId: 'agent-1' }
    const { result } = await executeIngest({
      organization: { id: organizationId },
      workflowExecutor: makeReader(),
      payload,
    })
    expect(result.runId).toBe('run-1')
    expect(ingestTrace).toHaveBeenCalledTimes(1)
  })

  it('refuses to ingest under an organization outside the verified tenant before any write', async () => {
    await expect(
      executeIngest({
        organization: null,
        workflowExecutor: makeReader(),
        payload: { runtime: 'opencode', externalRunId: 'run-1', agentId: 'agent-1' },
      }),
    ).rejects.toBeInstanceOf(CrudHttpError)
    expect(ingestTrace).not.toHaveBeenCalled()
  })

  it('enforces the workflow check on the run selected by the command', async () => {
    await expect(
      executeIngest({
        organization: { id: organizationId },
        workflowExecutor: makeReader(false),
        run: linkedRun,
        systemActor: true,
        payload: {
          runtime: 'opencode',
          externalRunId: 'run-1',
          agentId: 'agent-1',
          workflowInstanceId,
          costMinor: 40,
        },
      }),
    ).rejects.toMatchObject({ status: 422 })
    expect(ingestTrace).toHaveBeenCalledTimes(1)
  })

  it('binds the webhook dispatch to its verified scope even if the command input changes', async () => {
    await expect(executeIngest({
      organization: { id: organizationId },
      workflowExecutor: makeReader(),
      payload: { runtime: 'opencode', externalRunId: 'run-1', agentId },
      authority: { source: 'webhook', ...scope, organizationId: workflowInstanceId },
    })).rejects.toMatchObject({ status: 401 })
    expect(organizationQueries).toHaveLength(0)
    expect(ingestTrace).not.toHaveBeenCalled()
  })

  it('allows trusted parallel OpenCode capture only for its persisted run without correlation fields', async () => {
    const workflowExecutor = makeReader(false)
    const options = {
      organization: { id: organizationId },
      workflowExecutor,
      payload: { runtime: 'opencode', externalRunId: 'run-1', agentId },
      run: { ...linkedRun, invocationId: null },
      authority: { source: 'opencode' as const, ...scope, runId: linkedRun.id },
    }
    await expect(executeIngest(options)).resolves.toMatchObject({ result: { runId: linkedRun.id } })
    await expect(executeIngest({ ...options, run: { ...linkedRun, id: 'run-2' } })).rejects.toMatchObject({ status: 422 })
    await expect(executeIngest({ ...options, payload: { ...options.payload, workflowInstanceId } }))
      .rejects.toMatchObject({ status: 422 })
    expect(workflowExecutor.hasWorkflowStepReference).not.toHaveBeenCalled()
  })
})
