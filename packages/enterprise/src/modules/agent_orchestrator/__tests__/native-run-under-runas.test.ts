// A full native agent run bound to an agent principal (`ctx.runAs`), end to end
// through the real runner, guardrail persistence, context assembly, trace
// ingest and online eval, over an in-memory EntityManager whose flush fires the
// registered MikroORM subscribers exactly like the real event manager — so the
// fail-closed no-bypass guard sees every write the run makes. The model is
// scripted. Assertions read the persisted ROWS: three of the write sites
// swallow their errors, so a run that merely does not throw proves nothing.
//
// Identity spec Phase 0 (2026-10-21-agent-invocation-access-and-identity-binding):
// the runtime's own append-only audit writes run inside the runtime-audit write
// scope, so the principal-bound run persists every audit row while a domain
// write reaching a wrapped site still fails closed.

import { randomUUID } from 'node:crypto'
import type { EventArgs, EventSubscriber } from '@mikro-orm/core'
import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import { captureLogs } from './support/captureLogs'

jest.setTimeout(60_000)

const runAiAgentObjectMock = jest.fn<Promise<unknown>, [Record<string, unknown>]>()
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime', () => ({
  runAiAgentObject: (args: Record<string, unknown>) => runAiAgentObjectMock(args),
}))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory', () => ({
  createModelFactory: () => ({
    resolveModel: () => ({ providerId: 'test-provider', modelId: 'test-model', model: {}, source: 'env_default' }),
  }),
}))

const resolveCurrentGroundingSetMock = jest.fn<Promise<unknown>, unknown[]>()
jest.mock('../lib/guardrails/syncGroundingSets', () => ({
  resolveCurrentGroundingSet: (...args: unknown[]) => resolveCurrentGroundingSetMock(...args),
}))

jest.mock('../events', () => {
  const actual = jest.requireActual('../events')
  return { ...actual, emitAgentOrchestratorEvent: jest.fn(async () => undefined) }
})

import { z } from 'zod'
import { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { registerContextModule, entityProvenance } from '../lib/context/registry'
import { resetAgentAdmissionForTests } from '../lib/runtime/admission'
import { resetProviderBudgetForTests } from '../lib/runtime/providerBudget'
import { AgentWriteBypassError, registerAgentKindNoBypassSubscriber } from '../lib/identity/agentNoBypassSubscriber'
import { withAgentActor } from '../lib/identity/agentWriteScope'
import { persistVerdict, GUARDRAIL_SET_VERSION } from '../lib/guardrails/guardrailService'
import {
  AgentContextBundle,
  AgentEvalAssertion,
  AgentEvalResult,
  AgentGuardrailCheck,
  AgentProposal,
  AgentRun,
  AgentSpan,
  AgentToolCall,
} from '../data/entities'

type Row = Record<string, unknown>
type EntityClass = { name: string }

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const HUMAN = '33333333-3333-4333-8333-333333333333'
const AGENT_USER = '44444444-4444-4444-8444-444444444444'
const AGENT_ID = 'runas_test.grounded_researcher'
const SUBJECT_ENTITY = 'runas_test:subject'
const SUBJECT_ID = 'subject-1'
const SUBJECT_LOCATOR = `${SUBJECT_ENTITY}:${SUBJECT_ID}`

/**
 * In-memory EntityManager modelled on MikroORM's unit of work: forks share the
 * committed store and the event manager but keep their own identity map, reads
 * hand out managed copies, and `flush()` fires `beforeCreate`/`beforeUpdate` on
 * every registered subscriber for the new and changed entities BEFORE anything
 * commits — a subscriber that throws aborts the whole flush, so a rejected write
 * never reaches the store.
 */
function createFakeOrm() {
  const committed = new Map<EntityClass, Row[]>()
  const subscribers: Array<EventSubscriber<unknown>> = []
  const eventManager = {
    registerSubscriber(subscriber: EventSubscriber<unknown>) {
      subscribers.push(subscriber)
    },
  }

  function tableFor(entity: EntityClass): Row[] {
    const existing = committed.get(entity)
    if (existing) return existing
    const created: Row[] = []
    committed.set(entity, created)
    return created
  }

  function matchesValue(actual: unknown, expected: unknown): boolean {
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
    }
    if (expected === null) return actual === null || actual === undefined
    return actual === expected
  }

  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => matchesValue(row[key], value))
  }

  function createEm() {
    const entityOf = new WeakMap<Row, EntityClass>()
    const managed = new Map<Row, string | null>()
    const pending: Row[] = []

    function manage(entity: EntityClass, record: Row): Row {
      for (const [row] of managed) {
        if (entityOf.get(row) === entity && row.id === record.id) return row
      }
      const copy = structuredClone(record)
      entityOf.set(copy, entity)
      managed.set(copy, JSON.stringify(copy))
      return copy
    }

    function argsFor(row: Row): EventArgs<unknown> {
      const entity = entityOf.get(row)
      return { entity: row, meta: { className: entity?.name } } as unknown as EventArgs<unknown>
    }

    const em = {
      fork: () => createEm(),
      getEventManager: () => eventManager,
      create(entity: EntityClass, data: Row): Row {
        const row: Row = { ...data }
        entityOf.set(row, entity)
        return row
      },
      persist(row: Row) {
        if (!managed.has(row) && !pending.includes(row)) pending.push(row)
        return em
      },
      async flush() {
        const creates = pending.slice()
        const updates = [...managed.entries()]
          .filter(([row, snapshot]) => snapshot !== null && JSON.stringify(row) !== snapshot)
          .map(([row]) => row)
        for (const row of creates) {
          for (const subscriber of subscribers) subscriber.beforeCreate?.(argsFor(row))
        }
        for (const row of updates) {
          for (const subscriber of subscribers) subscriber.beforeUpdate?.(argsFor(row))
        }
        pending.length = 0
        for (const row of creates) {
          if (!row.id) row.id = randomUUID()
          tableFor(entityOf.get(row) as EntityClass).push(structuredClone(row))
          managed.set(row, JSON.stringify(row))
        }
        for (const row of updates) {
          const table = tableFor(entityOf.get(row) as EntityClass)
          const index = table.findIndex((stored) => stored.id === row.id)
          if (index >= 0) table[index] = structuredClone(row)
          managed.set(row, JSON.stringify(row))
        }
      },
      async findOne(entity: EntityClass, where: Row) {
        const found = tableFor(entity).find((row) => matches(row, where))
        return found ? manage(entity, found) : null
      },
      async find(entity: EntityClass, where: Row) {
        return tableFor(entity)
          .filter((row) => matches(row, where))
          .map((row) => manage(entity, row))
      },
    }
    return em
  }

  return {
    em: createEm(),
    rows(entity: EntityClass): Row[] {
      return tableFor(entity)
    },
    seed(entity: EntityClass, row: Row) {
      tableFor(entity).push(structuredClone(row))
    },
  }
}

type FakeOrm = ReturnType<typeof createFakeOrm>

/**
 * Stand-in for the module's run/proposal Commands: each write flushes through a
 * fork of the shared EM, as the real handlers do, inside the audited-command
 * scope the real `persistence.ts` wrappers establish around `commandBus.execute`.
 */
function createCommandBus(orm: FakeOrm) {
  return {
    async execute(commandId: string, args: { input: Row }) {
      const em = orm.em.fork()
      const input = args.input
      if (commandId === 'agent_orchestrator.runs.create') {
        const id = randomUUID()
        em.persist(
          em.create(AgentRun, {
            id,
            tenantId: input.tenantId,
            organizationId: input.organizationId,
            agentId: input.agentId,
            input: input.input,
            status: 'running',
            runtime: input.runtime,
            externalRunId: input.stampExternalRunIdFromId ? id : (input.externalRunId ?? null),
            source: input.source ?? 'runtime',
          }),
        )
        await em.flush()
        return { result: { runId: id } }
      }
      if (commandId === 'agent_orchestrator.runs.complete' || commandId === 'agent_orchestrator.runs.fail') {
        const run = await em.findOne(AgentRun, { id: input.runId })
        if (!run) throw new Error(`[internal] unknown run ${String(input.runId)}`)
        const { runId: _runId, errorMessage, ...fields } = input
        Object.assign(run, fields, {
          status: commandId === 'agent_orchestrator.runs.complete' ? 'ok' : 'error',
          ...(typeof errorMessage === 'string' ? { errorMessage } : {}),
          completedAt: new Date().toISOString(),
        })
        await em.flush()
        return { result: { runId: input.runId } }
      }
      if (commandId === 'agent_orchestrator.proposals.create') {
        em.persist(em.create(AgentProposal, { ...input, disposition: 'pending' }))
        await em.flush()
        return { result: {} }
      }
      throw new Error(`[internal] unexpected command ${commandId}`)
    },
  }
}

function createQueryEngine(): QueryEngine {
  return {
    async query<T = unknown>(entity: string, _opts: QueryOptions = {}): Promise<QueryResult<T>> {
      const items = (entity === SUBJECT_ENTITY ? [{ id: SUBJECT_ID, title: 'Acme renewal' }] : []) as unknown as T[]
      return { items, page: 1, pageSize: 100, total: items.length }
    },
  }
}

function createService(orm: FakeOrm): AgentRuntimeService {
  const registrations: Record<string, unknown> = { em: orm.em, queryEngine: createQueryEngine() }
  const container = {
    resolve(name: string) {
      if (name in registrations) return registrations[name]
      throw new Error(`[internal] unexpected resolve("${name}")`)
    },
    hasRegistration(name: string) {
      return name in registrations
    },
  }
  return new AgentRuntimeService({ container: container as never, commandBus: createCommandBus(orm) as never })
}

function registerGroundedResearcher(): AgentRegistryEntry {
  const existing = getAgentEntry(AGENT_ID)
  if (existing) return existing
  const entry: AgentRegistryEntry = {
    id: AGENT_ID,
    moduleId: 'agent_orchestrator',
    resultKind: 'research',
    schema: z.object({
      kind: z.literal('research'),
      data: z.object({
        summary: z.string(),
        claims: z.array(
          z.object({
            claim: z.string(),
            citations: z.array(z.object({ sourceKind: z.string(), sourceRef: z.string(), locator: z.string() })),
          }),
        ),
      }),
    }),
    tools: ['customers.get_deal'],
    skills: [],
    subAgents: [],
    label: 'runAs grounded researcher',
    description: 'Factual researcher for the principal-bound native run test.',
    instructions: 'research',
    runtime: 'native',
  }
  registerFileAgent(entry)
  return entry
}

const SCRIPTED_OUTPUT = {
  kind: 'research',
  data: {
    summary: 'The renewal is on track.',
    claims: [
      {
        claim: 'renewal status',
        citations: [{ sourceKind: 'entity', sourceRef: SUBJECT_ID, locator: SUBJECT_LOCATOR }],
      },
    ],
  },
}

function scriptModel(): void {
  runAiAgentObjectMock.mockImplementation(async (args) => {
    const loop = args.loop as { onStepFinish?: (event: unknown) => Promise<void> } | undefined
    await loop?.onStepFinish?.({
      toolCalls: [{ toolName: 'customers.get_deal', args: { id: SUBJECT_ID }, result: { status: 'open' } }],
      finishReason: 'tool-calls',
      usage: { inputTokens: 40, outputTokens: 8 },
      response: { modelId: 'test-model' },
    })
    await loop?.onStepFinish?.({
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 30, outputTokens: 12 },
      response: { modelId: 'test-model' },
    })
    return { mode: 'generate', object: SCRIPTED_OUTPUT, usage: { inputTokens: 70, outputTokens: 20 } }
  })
}

function seedOnlineEval(orm: FakeOrm): void {
  orm.seed(AgentEvalAssertion, {
    id: randomUUID(),
    tenantId: TENANT,
    organizationId: ORG,
    key: 'output_present',
    scorerKey: 'output_present',
    title: 'Output present',
    appliesTo: AGENT_ID,
    type: 'deterministic',
    severity: 'gate',
    enabled: true,
    deletedAt: null,
    config: null,
  })
}

const baseCtx = { tenantId: TENANT, organizationId: ORG, userId: HUMAN }
const runAsCtx = { ...baseCtx, runAs: { agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN } }

function rowsForRun(orm: FakeOrm, entity: EntityClass, runId: string): Row[] {
  return orm.rows(entity).filter((row) => row.agentRunId === runId)
}

function onlyRun(orm: FakeOrm): Row {
  const runs = orm.rows(AgentRun)
  expect(runs).toHaveLength(1)
  return runs[0]
}

function expectEveryAuditRow(orm: FakeOrm): void {
  const run = onlyRun(orm)
  const runId = String(run.id)
  expect(run.status).toBe('ok')

  const checks = rowsForRun(orm, AgentGuardrailCheck, runId)
  expect(checks.map((check) => check.kind).sort()).toEqual(['grounding', 'schema', 'tool_scope'])
  expect(checks.every((check) => check.phase === 'output')).toBe(true)

  const bundles = rowsForRun(orm, AgentContextBundle, runId)
  expect(bundles).toHaveLength(1)
  expect(bundles[0].capability).toBe(AGENT_ID)

  const spans = rowsForRun(orm, AgentSpan, runId)
  expect(spans.map((span) => span.kind).sort()).toEqual(['llm', 'llm', 'tool'])
  const toolCalls = rowsForRun(orm, AgentToolCall, runId)
  expect(toolCalls).toHaveLength(1)
  expect(toolCalls[0].toolName).toBe('customers.get_deal')

  const evalResults = rowsForRun(orm, AgentEvalResult, runId)
  expect(evalResults).toHaveLength(1)
  expect(evalResults[0].assertionKey).toBe('output_present')
  expect(evalResults[0].passed).toBe(true)
}

beforeAll(() => {
  registerGroundedResearcher()
  registerContextModule({
    capability: AGENT_ID,
    sources: [
      {
        kind: 'entity',
        tier: 'mandatory',
        entityType: SUBJECT_ENTITY,
        priority: 0,
        fields: ['id', 'title'],
        provenance: entityProvenance(SUBJECT_ENTITY),
      },
    ],
  })
})

beforeEach(() => {
  runAiAgentObjectMock.mockReset()
  resolveCurrentGroundingSetMock.mockReset().mockResolvedValue({
    version: 'grounding-test-v1',
    body: {
      capability: AGENT_ID,
      factual: true,
      kind: 'grounding',
      claimsPath: 'data.claims',
      missingCitation: 'warn',
      unresolvableCitation: 'warn',
      minScore: 0,
    },
  })
  scriptModel()
  delete process.env.OM_AGENT_TRACE_CAPTURE
})

afterEach(() => {
  resetAgentAdmissionForTests()
  resetProviderBudgetForTests()
})

describe('native run without a principal (harness control)', () => {
  it('persists guardrail checks, the context bundle, spans, tool calls and eval results', async () => {
    const orm = createFakeOrm()
    seedOnlineEval(orm)

    const result = await createService(orm).run(AGENT_ID, { subjectId: SUBJECT_ID }, baseCtx)

    expect(result.kind).toBe('research')
    expectEveryAuditRow(orm)
  })
})

describe('native run under runAs (agent principal on behalf of a human)', () => {
  it('persists every runtime audit row without tripping the no-bypass guard', async () => {
    const orm = createFakeOrm()
    seedOnlineEval(orm)

    const result = await createService(orm).run(AGENT_ID, { subjectId: SUBJECT_ID }, runAsCtx)

    expect(result.kind).toBe('research')
    expectEveryAuditRow(orm)
  })

  it('completes the run and logs no context-assembly or trace-capture failure', async () => {
    const orm = createFakeOrm()
    seedOnlineEval(orm)
    const logs = captureLogs()

    try {
      await createService(orm).run(AGENT_ID, { subjectId: SUBJECT_ID }, runAsCtx)
    } finally {
      logs.restore()
    }

    const warnings = logs.at('warn').map((record) => record.message)
    expect(warnings).not.toContain('context assembly failed')
    expect(warnings).not.toContain('native trace capture failed for run')
    expect(JSON.stringify(logs.at('warn'))).not.toContain('agent_write_bypass')
    expect(onlyRun(orm).status).toBe('ok')
  })

  it('fails the run cleanly when the final guardrail persistence throws unexpectedly', async () => {
    const orm = createFakeOrm()
    seedOnlineEval(orm)
    const persistFailure = new Error('[internal] guardrail store unavailable')
    orm.em.getEventManager().registerSubscriber({
      beforeCreate(args: EventArgs<unknown>) {
        const className = (args.meta as { className?: string } | undefined)?.className
        if (className === AgentGuardrailCheck.name) throw persistFailure
      },
    })

    await expect(createService(orm).run(AGENT_ID, { subjectId: SUBJECT_ID }, runAsCtx)).rejects.toBe(persistFailure)

    const run = onlyRun(orm)
    expect(run.status).toBe('error')
    expect(run.errorMessage).toBe(persistFailure.message)
    expect(orm.rows(AgentProposal)).toHaveLength(0)
    expect(rowsForRun(orm, AgentSpan, String(run.id)).length).toBeGreaterThan(0)
  })

  it('does not launder a domain write pending at a wrapped site: the flush still fails closed', async () => {
    const orm = createFakeOrm()
    registerAgentKindNoBypassSubscriber(orm.em)
    const em = orm.em.fork()
    const DomainDeal = class DomainDeal {}
    em.persist(em.create(DomainDeal, { tenantId: TENANT, organizationId: ORG, title: 'tampered' }))

    const attempt = withAgentActor({ agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN }, () =>
      persistVerdict(
        { em: em as never, emit: async () => undefined },
        { tenantId: TENANT, organizationId: ORG, agentRunId: randomUUID() },
        {
          verdict: {
            result: 'pass',
            checks: [{ kind: 'schema', result: 'pass', guardrailSetVersion: GUARDRAIL_SET_VERSION }],
          },
          capability: AGENT_ID,
          phase: 'output',
        },
      ),
    )

    await expect(attempt).rejects.toBeInstanceOf(AgentWriteBypassError)
    await expect(attempt).rejects.toThrow('entity=DomainDeal')
    expect(orm.rows(DomainDeal)).toHaveLength(0)
    expect(orm.rows(AgentGuardrailCheck)).toHaveLength(0)
  })
})
