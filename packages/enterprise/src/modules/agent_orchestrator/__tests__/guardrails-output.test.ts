import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { AgentGuardrailCheck, AgentProposal } from '../data/entities'
import {
  GuardrailService,
  persistVerdict,
  GUARDRAIL_SET_VERSION,
} from '../lib/guardrails/guardrailService'

/**
 * In-memory EntityManager fake (mirrors trace-ingestion-service.test.ts) covering
 * the create/persist/flush surface persistVerdict + the proposal create use. The
 * append-only / one-row-per-check properties are exercised without a DB.
 */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }

  const em = {
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
  }
  return { em: em as unknown as EntityManager, storeFor }
}

// The per-capability proposal contract (the agent's declared outcome schema).
const capabilitySchema = z.object({
  kind: z.literal('actionable'),
  proposal: z.object({
    actions: z
      .array(z.object({ type: z.literal('set_stage'), payload: z.object({ stage: z.string().min(1) }) }))
      .min(1),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1),
  }),
})

const VALID_OUTPUT = {
  kind: 'actionable',
  proposal: {
    actions: [{ type: 'set_stage', payload: { stage: 'qualified' } }],
    confidence: 0.9,
    rationale: 'looks healthy',
  },
}

// Missing required `confidence`/`rationale` and an empty stage → schema violation.
const INVALID_OUTPUT = {
  kind: 'actionable',
  proposal: { actions: [{ type: 'set_stage', payload: { stage: '' } }] },
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1', agentRunId: 'run-1' }
const CAPABILITY = 'deals.health_check'

function fakeContainer() {
  // GuardrailService.checkOutput is pure over its args; it never touches the
  // container, so a stub is sufficient for these tests.
  return {} as unknown as import('awilix').AwilixContainer
}

describe('GuardrailService.checkOutput (Phase 1)', () => {
  it('schema-violating output → block verdict; one block schema row appended; tripped emitted; no proposal', async () => {
    const { em, storeFor } = createFakeEm()
    const emit = jest.fn().mockResolvedValue(undefined)
    const service = new GuardrailService(fakeContainer())

    const verdict = await service.checkOutput({
      capability: CAPABILITY,
      schema: capabilitySchema,
      output: INVALID_OUTPUT,
    })

    expect(verdict.result).toBe('block')
    expect(verdict.blockedReason).toEqual({ phase: 'output', kind: 'schema' })

    await persistVerdict({ em, emit }, SCOPE, {
      verdict,
      capability: CAPABILITY,
      phase: 'output',
      proposalId: null,
    })

    const rows = storeFor(AgentGuardrailCheck)
    const blockRows = rows.filter((r) => r.result === 'block')
    expect(blockRows).toHaveLength(1)
    expect(blockRows[0].kind).toBe('schema')
    expect(blockRows[0].proposalId).toBeNull()
    expect(blockRows[0].guardrailSetVersion).toBe(GUARDRAIL_SET_VERSION)

    // tripped emitted exactly for the block (the tool_scope pass row stays silent).
    const trippedCalls = emit.mock.calls.filter(
      ([id]) => id === 'agent_orchestrator.guardrail.tripped',
    )
    expect(trippedCalls).toHaveLength(1)
    expect(trippedCalls[0][1]).toMatchObject({
      agentRunId: 'run-1',
      capability: CAPABILITY,
      phase: 'output',
      kind: 'schema',
      result: 'block',
      guardrailSetVersion: GUARDRAIL_SET_VERSION,
    })

    // Block path never creates a proposal.
    expect(storeFor(AgentProposal)).toHaveLength(0)
  })

  it('valid output → pass schema + pass tool_scope rows; guardResults attach to the created proposal', async () => {
    const { em, storeFor } = createFakeEm()
    const emit = jest.fn().mockResolvedValue(undefined)
    const service = new GuardrailService(fakeContainer())

    const verdict = await service.checkOutput({
      capability: CAPABILITY,
      schema: capabilitySchema,
      output: VALID_OUTPUT,
    })

    expect(verdict.result).toBe('pass')
    expect(verdict.blockedReason).toBeUndefined()
    expect(verdict.checks.map((c) => `${c.kind}:${c.result}`)).toEqual([
      'schema:pass',
      'tool_scope:pass',
    ])

    const guardResults = await persistVerdict({ em, emit }, SCOPE, {
      verdict,
      capability: CAPABILITY,
      phase: 'output',
      proposalId: null,
    })

    const rows = storeFor(AgentGuardrailCheck)
    expect(rows).toHaveLength(2)
    expect(rows.filter((r) => r.kind === 'schema' && r.result === 'pass')).toHaveLength(1)
    expect(rows.filter((r) => r.kind === 'tool_scope' && r.result === 'pass')).toHaveLength(1)

    // pass verdict emits nothing.
    expect(
      emit.mock.calls.filter(([id]) => id === 'agent_orchestrator.guardrail.tripped'),
    ).toHaveLength(0)

    // Attach guardResults to a created proposal (mirrors the runtime create call).
    const proposal = em.create(AgentProposal, {
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      agentId: CAPABILITY,
      runId: SCOPE.agentRunId,
      payload: VALID_OUTPUT.proposal,
      guardResults,
    })
    em.persist(proposal)
    await em.flush()

    const proposals = storeFor(AgentProposal)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].guardResults).toBe(guardResults)
    expect((proposals[0].guardResults as unknown[])).toHaveLength(2)
  })

  it('append-only: every check writes exactly one row (count = number of checks)', async () => {
    const { em, storeFor } = createFakeEm()
    const emit = jest.fn().mockResolvedValue(undefined)
    const service = new GuardrailService(fakeContainer())

    const verdict = await service.checkOutput({
      capability: CAPABILITY,
      schema: capabilitySchema,
      output: VALID_OUTPUT,
    })
    await persistVerdict({ em, emit }, SCOPE, {
      verdict,
      capability: CAPABILITY,
      phase: 'output',
      proposalId: null,
    })

    expect(storeFor(AgentGuardrailCheck)).toHaveLength(verdict.checks.length)
  })
})

describe('GuardrailService.checkInput (Phase 1 stub)', () => {
  it('is a pass-through that records no checks (moderation/PII deferred)', async () => {
    const service = new GuardrailService(fakeContainer())
    const verdict = await service.checkInput({ capability: CAPABILITY })
    expect(verdict.result).toBe('pass')
    expect(verdict.checks).toEqual([])
  })
})
