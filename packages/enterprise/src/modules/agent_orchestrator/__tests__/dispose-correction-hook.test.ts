import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AgentProposal, AgentRun, AgentCorrection, AgentEvalCase } from '../data/entities'

// The dispose command's correction hook (step 8b) is the integration seam under
// test: it must dispatch `corrections.create` for human edit/reject verdicts and
// stay silent for approve/auto_approve. We stub the cross-cutting collaborators
// the command calls — workflow resume, the event emitter, and the RBAC mutation
// guard — so the test isolates the correction branch. The correction-create
// command + recordCorrection run for REAL against the in-memory EM, so the test
// proves an actual AgentCorrection + draft AgentEvalCase are written.
jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))
jest.mock('../lib/disposition/resume', () => ({
  resumeWorkflowForProposal: jest.fn(async () => {}),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => null),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => {}),
}))

import { disposeProposalCommand } from '../commands/dispose'
import { createCorrectionCommand } from '../commands/corrections'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444'
const RUN_ID = '55555555-5555-4555-8555-555555555555'

const ORIGINAL_PAYLOAD = { stage: 'won', confidence: 0.4 }
const EDITED_PAYLOAD = { stage: 'lost', confidence: 0.9 }

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
    return Object.entries(where).every(([key, value]) => row[key] === value)
  }

  const em = {
    // fork() shares the same stores so the dispose command and the nested
    // corrections.create command (each forks) read/write the same in-memory DB.
    fork() {
      return em
    },
    // withAtomicFlush({ transaction: true }) opens a real transaction on a true
    // EM; the in-memory fake commits on flush, so the boundaries are no-ops.
    async begin() {},
    async commit() {},
    async rollback() {},
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

function seedProposalAndRun(storeFor: (entity: unknown) => Array<Record<string, unknown>>) {
  storeFor(AgentRun).push({
    __entity: AgentRun,
    id: RUN_ID,
    tenantId: TENANT,
    organizationId: ORG,
    input: { dealId: 'deal-1' },
  })
  const proposal: Record<string, unknown> = {
    __entity: AgentProposal,
    id: PROPOSAL_ID,
    tenantId: TENANT,
    organizationId: ORG,
    runId: RUN_ID,
    agentId: 'deals.health_check',
    processId: null,
    stepId: null,
    disposition: 'pending',
    dispositionBy: null,
    dispositionReason: null,
    payload: ORIGINAL_PAYLOAD,
    updatedAt: new Date('2026-06-24T00:00:00.000Z'),
    deletedAt: null,
  }
  storeFor(AgentProposal).push(proposal)
  return proposal
}

describe('dispose command — correction flywheel hook (step 8b)', () => {
  function makeCtx(em: EntityManager): CommandRuntimeContext {
    // A real-but-minimal command bus: routes corrections.create to its actual
    // handler so the correction + draft eval case are genuinely written.
    const commandBus = {
      async execute(commandId: string, args: { input: unknown; ctx: CommandRuntimeContext }) {
        if (commandId === 'agent_orchestrator.corrections.create') {
          return createCorrectionCommand.execute(args.input as never, args.ctx)
        }
        throw new Error(`[internal] unexpected command ${commandId}`)
      },
    }
    const container = {
      resolve(name: string) {
        if (name === 'em') return em
        if (name === 'commandBus') return commandBus
        throw new Error(`[internal] unexpected resolve(${name})`)
      },
    }
    return {
      container,
      request: new Request('http://test/dispose', { method: 'POST' }),
    } as unknown as CommandRuntimeContext
  }

  it('records ONE correction (proposedValue = ORIGINAL payload) + draft eval case for an edit', async () => {
    const { em, storeFor } = createFakeEm()
    seedProposalAndRun(storeFor)

    await disposeProposalCommand.execute(
      {
        proposalId: PROPOSAL_ID,
        tenantId: TENANT,
        organizationId: ORG,
        userId: USER,
        disposition: 'edited',
        payload: EDITED_PAYLOAD,
        reason: 'wrong stage',
      },
      makeCtx(em),
    )

    const corrections = storeFor(AgentCorrection)
    const cases = storeFor(AgentEvalCase)
    expect(corrections).toHaveLength(1)
    expect(cases).toHaveLength(1)

    expect(corrections[0].action).toBe('edit')
    // proposedValue MUST be the agent's ORIGINAL pre-edit payload, not the edit.
    expect(corrections[0].proposedValue).toEqual(ORIGINAL_PAYLOAD)
    expect(corrections[0].correctedValue).toEqual(EDITED_PAYLOAD)
    expect(corrections[0].reason).toBe('wrong stage')

    expect(cases[0].status).toBe('draft')
    expect(cases[0].sourceType).toBe('correction')
    expect(cases[0].sourceId).toBe(corrections[0].id)
    expect(cases[0].expected).toEqual(EDITED_PAYLOAD)
  })

  it('records a correction (action=reject, correctedValue null) for a reject', async () => {
    const { em, storeFor } = createFakeEm()
    seedProposalAndRun(storeFor)

    await disposeProposalCommand.execute(
      {
        proposalId: PROPOSAL_ID,
        tenantId: TENANT,
        organizationId: ORG,
        userId: USER,
        disposition: 'rejected',
        reason: 'not actionable',
      },
      makeCtx(em),
    )

    const corrections = storeFor(AgentCorrection)
    expect(corrections).toHaveLength(1)
    expect(corrections[0].action).toBe('reject')
    expect(corrections[0].proposedValue).toEqual(ORIGINAL_PAYLOAD)
    expect(corrections[0].correctedValue).toBeNull()
    expect(storeFor(AgentEvalCase)[0].expected).toBeNull()
  })

  it('records NO correction and NO draft eval case for an approve', async () => {
    const { em, storeFor } = createFakeEm()
    seedProposalAndRun(storeFor)

    await disposeProposalCommand.execute(
      {
        proposalId: PROPOSAL_ID,
        tenantId: TENANT,
        organizationId: ORG,
        userId: USER,
        disposition: 'approved',
      },
      makeCtx(em),
    )

    expect(storeFor(AgentCorrection)).toHaveLength(0)
    expect(storeFor(AgentEvalCase)).toHaveLength(0)
  })

  it('records NO correction for an auto_approve (internal rule verdict)', async () => {
    const { em, storeFor } = createFakeEm()
    seedProposalAndRun(storeFor)

    await disposeProposalCommand.execute(
      {
        proposalId: PROPOSAL_ID,
        tenantId: TENANT,
        organizationId: ORG,
        userId: null,
        disposition: 'auto_approved',
        dispositionBy: 'rule:threshold',
        skipResume: true,
      },
      makeCtx(em),
    )

    expect(storeFor(AgentCorrection)).toHaveLength(0)
    expect(storeFor(AgentEvalCase)).toHaveLength(0)
  })
})
