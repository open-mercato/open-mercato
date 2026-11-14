/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  AgentEvalResult,
  AgentGuardrailCheck,
  AgentProposal,
  AgentRun,
  AgentSpan,
  AgentToolCall,
  ProcessInstance,
} from '../data/entities'
import {
  EFFECTOR_CLAIM_SPAN_PREFIX,
  RUN_EXPORT_ROOT_RUN_MAX_DEPTH,
  loadRunExportBundle,
} from '../lib/trace/otel/loadRunExportBundle'

jest.mock('../lib/sdk/defineAgent', () => ({
  getAgentEntry: jest.fn((id: string) => (id === 'deals.health_check' ? { id, label: 'Deal health check' } : undefined)),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333'
const OTHER_ORG = '44444444-4444-4444-8444-444444444444'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const PARENT_RUN_ID = '66666666-6666-4666-8666-666666666666'
const ROOT_RUN_ID = '77777777-7777-4777-8777-777777777777'
const FOREIGN_PARENT_ID = '88888888-8888-4888-8888-888888888888'
const WORKFLOW_INSTANCE_ID = '99999999-9999-4999-8999-999999999999'
const PROPOSAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RULE_PROPOSAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SECRET = 'customer@example.com secret body'

type Row = Record<string, unknown>
type EntityClass = abstract new (...args: never[]) => unknown
type Call = { method: 'find' | 'findOne'; entity: EntityClass; where: Row; options: Row | undefined }

function matchesCondition(row: Row, key: string, condition: unknown): boolean {
  if (key === '$or') {
    return (condition as Row[]).some((branch) => matchesWhere(row, branch))
  }
  const value = row[key]
  if (condition && typeof condition === 'object' && !Array.isArray(condition) && '$in' in condition) {
    return ((condition as { $in: unknown[] }).$in).includes(value)
  }
  if (condition === null) return value === null || value === undefined
  return value === condition
}

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => matchesCondition(row, key, condition))
}

function project(row: Row, options: Row | undefined): Row {
  const fields = options?.fields as string[] | undefined
  if (!fields) return row
  return Object.fromEntries(fields.filter((field) => field in row).map((field) => [field, row[field]]))
}

function createFakeEm(tables: Map<EntityClass, Row[]>) {
  const calls: Call[] = []
  const em = {
    find: jest.fn(async (entity: EntityClass, where: Row, options?: Row) => {
      calls.push({ method: 'find', entity, where, options })
      return (tables.get(entity) ?? []).filter((row) => matchesWhere(row, where)).map((row) => project(row, options))
    }),
    findOne: jest.fn(async (entity: EntityClass, where: Row, options?: Row) => {
      calls.push({ method: 'findOne', entity, where, options })
      const row = (tables.get(entity) ?? []).find((candidate) => matchesWhere(candidate, where))
      return row ? project(row, options) : null
    }),
  }
  return { em: em as unknown as EntityManager, calls }
}

const startedAt = new Date('2026-10-27T10:00:00.000Z')
const endedAt = new Date('2026-10-27T10:00:05.000Z')

function scoped(row: Row, tenantId = TENANT, organizationId = ORG): Row {
  return { tenantId, organizationId, ...row }
}

function baseRun(overrides: Row = {}): Row {
  return scoped({
    id: RUN_ID,
    agentId: 'deals.health_check',
    source: 'runtime',
    status: 'ok',
    parentRunId: PARENT_RUN_ID,
    rerunOfRunId: null,
    workflowInstanceId: WORKFLOW_INSTANCE_ID,
    stepId: 'review',
    invocationId: 'inv-1',
    proposalId: null,
    agentVersion: '1.2.0',
    model: 'gpt-test',
    runtime: 'native',
    confidence: 0.9,
    inputTokens: 120,
    outputTokens: 40,
    costMinor: 3,
    currency: 'USD',
    latencyMs: 5000,
    resultKind: 'proposal',
    agentType: 'proposer',
    input: { prompt: SECRET },
    output: { answer: SECRET },
    errorMessage: SECRET,
    deletedAt: null,
    createdAt: startedAt,
    completedAt: endedAt,
    ...overrides,
  })
}

function span(row: Row): Row {
  return scoped({
    agentRunId: RUN_ID,
    parentSpanId: null,
    status: 'ok',
    startedAt,
    endedAt,
    durationMs: 100,
    attributes: null,
    ...row,
  })
}

function buildTables(runOverrides: Row = {}): Map<EntityClass, Row[]> {
  return new Map<EntityClass, Row[]>([
    [
      AgentRun,
      [
        baseRun(runOverrides),
        scoped({ id: PARENT_RUN_ID, parentRunId: ROOT_RUN_ID, deletedAt: null }),
        scoped({ id: ROOT_RUN_ID, parentRunId: null, deletedAt: null }),
      ],
    ],
    [
      AgentSpan,
      [
        span({
          id: 'span-manifest',
          externalSpanId: `${RUN_ID}:manifest`,
          sequence: 99,
          name: 'run.manifest',
          kind: 'system',
          attributes: {
            'om.runtime': 'native',
            'om.entry_point': 'workflow',
            'om.platform_trace': { traceparent: '00-abc-def-01' },
          },
        }),
        span({ id: 'span-llm', externalSpanId: `${RUN_ID}:0`, sequence: 0, name: 'step 0', kind: 'llm', attributes: { inputTokens: 10 } }),
        span({ id: 'span-tool', externalSpanId: `${RUN_ID}:0:0`, sequence: 1, name: 'search', kind: 'tool', parentSpanId: 'span-llm' }),
        span({
          id: 'span-claim',
          agentRunId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          externalSpanId: `${EFFECTOR_CLAIM_SPAN_PREFIX}${PROPOSAL_ID}`,
          sequence: 0,
          name: 'proposal.execute',
          kind: 'system',
          attributes: { 'om.effector.ok': true },
        }),
        span({
          id: 'span-foreign-claim',
          externalSpanId: `${EFFECTOR_CLAIM_SPAN_PREFIX}${RULE_PROPOSAL_ID}`,
          sequence: 0,
          name: 'proposal.execute',
          kind: 'system',
          tenantId: OTHER_TENANT,
          organizationId: OTHER_ORG,
          agentRunId: RUN_ID,
        }),
        span({ id: 'span-foreign', externalSpanId: 'x', sequence: 5, name: 'foreign', kind: 'llm', tenantId: OTHER_TENANT }),
      ],
    ],
    [
      AgentToolCall,
      [
        scoped({
          id: 'tool-1',
          spanId: 'span-tool',
          agentRunId: RUN_ID,
          toolName: 'search',
          status: 'error',
          latencyMs: 12,
          requestSummary: { query: SECRET },
          responseSummary: { result: SECRET },
          errorMessage: SECRET,
          createdAt: startedAt,
        }),
      ],
    ],
    [
      AgentProposal,
      [
        scoped({
          id: PROPOSAL_ID,
          runId: RUN_ID,
          payload: { body: SECRET },
          disposition: 'approved',
          dispositionBy: 'user-1',
          dispositionReason: SECRET,
          selectedOptionId: 'opt-1',
          autoDispositionBlock: null,
          deletedAt: null,
          createdAt: startedAt,
          updatedAt: endedAt,
        }),
        scoped({
          id: RULE_PROPOSAL_ID,
          runId: RUN_ID,
          payload: { body: SECRET },
          disposition: 'auto_approved',
          dispositionBy: 'rule:threshold',
          dispositionReason: SECRET,
          selectedOptionId: null,
          autoDispositionBlock: null,
          deletedAt: null,
          createdAt: startedAt,
          updatedAt: endedAt,
        }),
      ],
    ],
    [
      AgentEvalResult,
      [
        scoped({
          id: 'eval-1',
          agentRunId: RUN_ID,
          assertionKey: 'schema.valid',
          score: 1,
          passed: true,
          severity: 'gate',
          evidence: { excerpt: SECRET },
          evaluatedAt: endedAt,
        }),
      ],
    ],
    [
      AgentGuardrailCheck,
      [
        scoped({
          id: 'guard-1',
          agentRunId: RUN_ID,
          proposalId: PROPOSAL_ID,
          guardrailSetVersion: 'v1',
          capability: 'pii',
          phase: 'output',
          kind: 'pii',
          result: 'warn',
          evidence: { match: SECRET },
          createdAt: endedAt,
        }),
      ],
    ],
    [
      ProcessInstance,
      [
        scoped({
          id: 'process-1',
          workflowInstanceId: WORKFLOW_INSTANCE_ID,
          processDefinitionId: 'def-1',
          workflowId: 'deal_review',
          status: 'completed',
          subjectType: 'deal',
          subjectTitle: SECRET,
          input: { note: SECRET },
          failureReason: SECRET,
          deletedAt: null,
          createdAt: startedAt,
          completedAt: endedAt,
        }),
      ],
    ],
  ])
}

describe('loadRunExportBundle', () => {
  it('returns null for an unknown, malformed or still-running run', async () => {
    const { em } = createFakeEm(buildTables({ status: 'running' }))
    await expect(loadRunExportBundle(em, RUN_ID)).resolves.toBeNull()
    await expect(loadRunExportBundle(em, 'ffffffff-ffff-4fff-8fff-fffffffffff0')).resolves.toBeNull()
    await expect(loadRunExportBundle(em, 'not-a-uuid')).resolves.toBeNull()
  })

  it('scopes every query after the run lookup by the run row tenant and organization', async () => {
    const { em, calls } = createFakeEm(buildTables())
    const bundle = await loadRunExportBundle(em, RUN_ID)
    expect(bundle).not.toBeNull()
    expect(calls[0]).toMatchObject({ method: 'findOne', entity: AgentRun, where: { id: RUN_ID } })
    const scopedCalls = calls.slice(1)
    expect(scopedCalls.length).toBeGreaterThanOrEqual(9)
    for (const call of scopedCalls) {
      expect(call.where).toMatchObject({ tenantId: TENANT, organizationId: ORG })
    }
    const queriedEntities = new Set(scopedCalls.map((call) => call.entity))
    for (const entity of [AgentSpan, AgentToolCall, AgentProposal, AgentEvalResult, AgentGuardrailCheck, ProcessInstance, AgentRun]) {
      expect(queriedEntities.has(entity)).toBe(true)
    }
  })

  it('selects only non-encrypted columns and never returns free text', async () => {
    const { em, calls } = createFakeEm(buildTables())
    const bundle = await loadRunExportBundle(em, RUN_ID)
    expect(JSON.stringify(bundle)).not.toContain('secret body')
    const forbidden = ['input', 'output', 'errorMessage', 'payload', 'dispositionReason', 'requestSummary', 'responseSummary', 'evidence', 'subjectTitle', 'failureReason']
    for (const call of calls) {
      const fields = call.options?.fields as string[] | undefined
      expect(fields).toBeDefined()
      for (const field of forbidden) expect(fields).not.toContain(field)
    }
  })

  it('maps the run, children, process instance, root run and agent label', async () => {
    const { em } = createFakeEm(buildTables())
    const bundle = await loadRunExportBundle(em, RUN_ID)
    expect(bundle?.run).toMatchObject({ id: RUN_ID, tenantId: TENANT, organizationId: ORG, status: 'ok', parentRunId: PARENT_RUN_ID })
    expect(bundle?.rootRunId).toBe(ROOT_RUN_ID)
    expect(bundle?.agentLabel).toBe('Deal health check')
    expect(bundle?.manifest).toMatchObject({
      'om.runtime': 'native',
      'om.entry_point': 'workflow',
      'om.platform_trace': { traceparent: '00-abc-def-01' },
    })
    expect(bundle?.spans.map((item) => item.id)).toEqual(['span-llm', 'span-tool'])
    expect(bundle?.spans[1]).toMatchObject({ parentSpanId: 'span-llm', kind: 'tool' })
    expect(bundle?.toolCalls).toEqual([
      { id: 'tool-1', spanId: 'span-tool', toolName: 'search', status: 'error', isError: true, latencyMs: 12, createdAt: startedAt },
    ])
    expect(bundle?.proposals.map((item) => [item.id, item.dispositionByKind])).toEqual([
      [PROPOSAL_ID, 'user'],
      [RULE_PROPOSAL_ID, 'rule'],
    ])
    expect(bundle?.evalResults).toEqual([
      { id: 'eval-1', assertionKey: 'schema.valid', score: 1, passed: true, severity: 'gate', evaluatedAt: endedAt },
    ])
    expect(bundle?.guardrailChecks[0]).toMatchObject({ capability: 'pii', phase: 'output', kind: 'pii', result: 'warn' })
    expect(bundle?.processInstance).toEqual({
      id: 'process-1',
      workflowInstanceId: WORKFLOW_INSTANCE_ID,
      processDefinitionId: 'def-1',
      workflowId: 'deal_review',
      status: 'completed',
      subjectType: 'deal',
      createdAt: startedAt,
      completedAt: endedAt,
    })
  })

  it('includes the in-tenant effector claim span keyed by proposal and skips foreign ones', async () => {
    const { em } = createFakeEm(buildTables())
    const bundle = await loadRunExportBundle(em, RUN_ID)
    expect(bundle?.effectorSpans).toHaveLength(1)
    expect(bundle?.effectorSpans[0]).toMatchObject({
      id: 'span-claim',
      proposalId: PROPOSAL_ID,
      attributes: { 'om.effector.ok': true },
    })
  })

  it('falls back to the agent id when the registry has no label', async () => {
    const { em } = createFakeEm(buildTables({ agentId: 'unknown.agent' }))
    const bundle = await loadRunExportBundle(em, RUN_ID)
    expect(bundle?.agentLabel).toBe('unknown.agent')
  })

  it('skips the process lookup for standalone runs and stops the root walk at a foreign parent', async () => {
    const tables = buildTables({ workflowInstanceId: null, parentRunId: FOREIGN_PARENT_ID })
    tables.get(AgentRun)?.push(scoped({ id: FOREIGN_PARENT_ID, parentRunId: null, deletedAt: null }, OTHER_TENANT))
    const foreign = createFakeEm(tables)
    const bundle = await loadRunExportBundle(foreign.em, RUN_ID)
    expect(bundle?.rootRunId).toBe(RUN_ID)
    expect(bundle?.processInstance).toBeNull()
    expect(foreign.calls.some((call) => call.entity === ProcessInstance)).toBe(false)
  })

  it('bounds the parent walk and tolerates cycles', async () => {
    const chainIds = Array.from({ length: RUN_EXPORT_ROOT_RUN_MAX_DEPTH + 5 }, (_, index) =>
      `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, '0')}`,
    )
    const chain = chainIds.map((id, index) => scoped({ id, parentRunId: chainIds[index + 1] ?? null, deletedAt: null }))
    const tables = buildTables({ parentRunId: chainIds[0] })
    tables.set(AgentRun, [baseRun({ parentRunId: chainIds[0] }), ...chain])
    const { em, calls } = createFakeEm(tables)
    const bundle = await loadRunExportBundle(em, RUN_ID)
    const parentLookups = calls.filter((call) => call.method === 'findOne' && call.entity === AgentRun).length - 1
    expect(parentLookups).toBe(RUN_EXPORT_ROOT_RUN_MAX_DEPTH)
    expect(bundle?.rootRunId).toBe(chainIds[RUN_EXPORT_ROOT_RUN_MAX_DEPTH - 1])

    const cyclic = buildTables({ parentRunId: PARENT_RUN_ID })
    cyclic.set(AgentRun, [baseRun(), scoped({ id: PARENT_RUN_ID, parentRunId: RUN_ID, deletedAt: null })])
    const cyclicEm = createFakeEm(cyclic)
    const cyclicBundle = await loadRunExportBundle(cyclicEm.em, RUN_ID)
    expect(cyclicBundle?.rootRunId).toBe(PARENT_RUN_ID)
  })

  it('resolves and forks the entity manager from a container', async () => {
    const { em } = createFakeEm(buildTables())
    const fork = jest.fn(() => em)
    const container = { resolve: jest.fn(() => ({ fork })) }
    const bundle = await loadRunExportBundle(container, RUN_ID)
    expect(container.resolve).toHaveBeenCalledWith('em')
    expect(fork).toHaveBeenCalled()
    expect(bundle?.run.id).toBe(RUN_ID)
  })
})
