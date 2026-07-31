import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AgentRun, AgentEvalCase } from '../data/entities'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

// The approve command uses withAtomicFlush (needs a transactional em the in-memory
// fake lacks). Run its phases inline + flush — createFromRun doesn't use it.
jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (em: { flush?: () => Promise<void> }, phases: Array<() => unknown>) => {
    for (const phase of phases) await phase()
    await em.flush?.()
  },
}))

import { createEvalCaseFromRunCommand, approveEvalCaseCommand } from '../commands/corrections'
import { canonicalInputKey } from '../lib/eval/canonicalInputKey'
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

const APPROVER = '33333333-3333-4333-8333-333333333333'

describe('evalCases.approve — input_key recompute', () => {
  beforeEach(() => jest.clearAllMocks())

  it('self-heals a null input_key on an already-approved case so it can golden-match', async () => {
    const { em, storeFor } = createFakeEm()
    storeFor(AgentEvalCase).push({
      __entity: AgentEvalCase,
      id: '44444444-4444-4444-8444-444444444444',
      tenantId: TENANT,
      organizationId: ORG,
      agentDefinitionId: 'deals.health_check',
      input: { dealId: 'deal-1' },
      inputKey: null, // legacy row created before the match-key feature
      status: 'approved',
      updatedAt: new Date(),
      deletedAt: null,
    })

    const result = await approveEvalCaseCommand.execute(
      { tenantId: TENANT, organizationId: ORG, evalCaseId: '44444444-4444-4444-8444-444444444444', approvedByUserId: APPROVER },
      makeCtx(em),
    )

    expect(result.status).toBe('approved')
    // Now equals canonicalInputKey(decrypted input) — the exact key evaluateRun
    // computes from a live run, so the golden match now fires.
    expect(storeFor(AgentEvalCase)[0].inputKey).toBe(canonicalInputKey({ dealId: 'deal-1' }))
  })

  it('sets input_key from the input when approving a draft', async () => {
    const { em, storeFor } = createFakeEm()
    storeFor(AgentEvalCase).push({
      __entity: AgentEvalCase,
      id: '66666666-6666-4666-8666-666666666666',
      tenantId: TENANT,
      organizationId: ORG,
      agentDefinitionId: 'deals.health_check',
      input: { dealId: 'deal-2' },
      inputKey: null,
      status: 'draft',
      updatedAt: new Date(),
      deletedAt: null,
    })

    await approveEvalCaseCommand.execute(
      { tenantId: TENANT, organizationId: ORG, evalCaseId: '66666666-6666-4666-8666-666666666666', approvedByUserId: APPROVER },
      makeCtx(em),
    )

    const row = storeFor(AgentEvalCase)[0]
    expect(row.status).toBe('approved')
    expect(row.inputKey).toBe(canonicalInputKey({ dealId: 'deal-2' }))
  })
})
