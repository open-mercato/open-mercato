import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AgentRun, AgentEvalCase } from '../data/entities'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

import { createEvalCaseFromRunCommand } from '../commands/corrections'
import { emitAgentOrchestratorEvent } from '../events'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const RUN_ID = '55555555-5555-4555-8555-555555555555'

/** Minimal in-memory EntityManager fake. See trace-ingestion-service.test.ts. */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    // `?? null` mirrors SQL NULL semantics: an unset column matches `where: null`.
    return Object.entries(where).every(([key, value]) => (row[key] ?? null) === value)
  }

  const em = {
    fork() {
      return em
    },
    create(entity: unknown, data: Record<string, unknown>) {
      const row: Record<string, unknown> = { ...data }
      ;(row as { __entity?: unknown }).__entity = entity
      return row
    },
    persist(row: Record<string, unknown>) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const entity = (row as { __entity?: unknown }).__entity
        const store = storeFor(entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>, _opts?: unknown) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

function makeCtx(em: EntityManager): CommandRuntimeContext {
  const container = {
    resolve(name: string) {
      if (name === 'em') return em
      throw new Error(`[internal] unexpected resolve(${name})`)
    },
  }
  return {
    container,
    request: new Request('http://test/eval-case', { method: 'POST' }),
  } as unknown as CommandRuntimeContext
}

function seedRun(
  storeFor: (entity: unknown) => Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
) {
  storeFor(AgentRun).push({
    __entity: AgentRun,
    id: RUN_ID,
    tenantId: TENANT,
    organizationId: ORG,
    agentId: 'deals.health_check',
    input: { dealId: 'deal-1' },
    output: { recommendedAction: 'nurture' },
    deletedAt: null,
    ...overrides,
  })
}

const INPUT = { tenantId: TENANT, organizationId: ORG, agentRunId: RUN_ID }

describe('evalCases.createFromRun command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('drafts a golden_run eval case from the run input/output and emits eval_case.created', async () => {
    const { em, storeFor } = createFakeEm()
    seedRun(storeFor)

    const result = await createEvalCaseFromRunCommand.execute(INPUT, makeCtx(em))

    const cases = storeFor(AgentEvalCase)
    expect(cases).toHaveLength(1)
    expect(result).toEqual({ evalCaseId: cases[0].id, status: 'draft', created: true })
    expect(cases[0]).toMatchObject({
      tenantId: TENANT,
      organizationId: ORG,
      sourceType: 'golden_run',
      sourceId: RUN_ID,
      agentDefinitionId: 'deals.health_check',
      input: { dealId: 'deal-1' },
      expected: { recommendedAction: 'nurture' },
      status: 'draft',
    })
    expect(emitAgentOrchestratorEvent).toHaveBeenCalledTimes(1)
    expect(emitAgentOrchestratorEvent).toHaveBeenCalledWith(
      'agent_orchestrator.eval_case.created',
      expect.objectContaining({
        id: cases[0].id,
        sourceType: 'golden_run',
        sourceId: RUN_ID,
        agentDefinitionId: 'deals.health_check',
        tenantId: TENANT,
        organizationId: ORG,
      }),
      { persistent: true },
    )
  })

  it('is idempotent — a second call returns the existing case without duplicating or re-emitting', async () => {
    const { em, storeFor } = createFakeEm()
    seedRun(storeFor)

    const first = await createEvalCaseFromRunCommand.execute(INPUT, makeCtx(em))
    const second = await createEvalCaseFromRunCommand.execute(INPUT, makeCtx(em))

    expect(storeFor(AgentEvalCase)).toHaveLength(1)
    expect(second).toEqual({ evalCaseId: first.evalCaseId, status: 'draft', created: false })
    expect(emitAgentOrchestratorEvent).toHaveBeenCalledTimes(1)
  })

  it('drafts with null expected when the run has no output', async () => {
    const { em, storeFor } = createFakeEm()
    seedRun(storeFor, { output: null })

    await createEvalCaseFromRunCommand.execute(INPUT, makeCtx(em))

    expect(storeFor(AgentEvalCase)[0].expected).toBeNull()
  })

  it('404s for a run in another organization (never leaks the row)', async () => {
    const { em, storeFor } = createFakeEm()
    seedRun(storeFor, { organizationId: OTHER_ORG })

    await expect(createEvalCaseFromRunCommand.execute(INPUT, makeCtx(em))).rejects.toMatchObject({
      status: 404,
    })
    expect(storeFor(AgentEvalCase)).toHaveLength(0)
    expect(emitAgentOrchestratorEvent).not.toHaveBeenCalled()
  })
})
