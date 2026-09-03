import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AgentProposal, AgentRun } from '../data/entities'

/**
 * `selectedOptionId` on the dispose contract (spec `2026-08-11-agent-taxonomy.md`,
 * Phase 2).
 *
 * The rule, stated once: REQUIRED for `approved` and `edited`, FORBIDDEN for
 * `rejected`, and an id the agent never offered is a 400. `edited` needs it because
 * editing means choosing an option AND changing its payload — there is nothing to
 * edit without naming which.
 *
 * The pre-existing `superRefine` rules (`payload` required for `edited`, `reason`
 * required for `edited`/`rejected`) are re-asserted here so a diff on this schema
 * cannot drop them.
 */

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

import { disposeProposalSchema } from '../data/validators'
import { disposeProposalCommand } from '../commands/dispose'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444'
const RUN_ID = '55555555-5555-4555-8555-555555555555'

const ACTION = { type: 'set_stage', payload: { stage: 'won' } }
const PAYLOAD = {
  options: [
    { id: 'advance', label: 'Advance', confidence: 0.7, actions: [ACTION] },
    { id: 'hold', label: 'Hold', confidence: 0.3, actions: [{ type: 'notify', payload: {} }] },
  ],
}

function issuePaths(input: unknown): string[] {
  const parsed = disposeProposalSchema.safeParse(input)
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'))
}

describe('disposeProposalSchema — selectedOptionId', () => {
  test('approve REQUIRES it', () => {
    expect(issuePaths({ disposition: 'approved' })).toContain('selectedOptionId')
    expect(disposeProposalSchema.safeParse({ disposition: 'approved', selectedOptionId: 'advance' }).success).toBe(true)
  })

  test('edit REQUIRES it, on top of the existing payload + reason rules', () => {
    expect(issuePaths({ disposition: 'edited', payload: {}, reason: 'why' })).toContain('selectedOptionId')
    expect(
      disposeProposalSchema.safeParse({
        disposition: 'edited',
        payload: {},
        reason: 'why',
        selectedOptionId: 'advance',
      }).success,
    ).toBe(true)
  })

  test('reject FORBIDS it — no option runs, so none may be recorded as chosen', () => {
    expect(issuePaths({ disposition: 'rejected', reason: 'no', selectedOptionId: 'advance' })).toContain(
      'selectedOptionId',
    )
    expect(disposeProposalSchema.safeParse({ disposition: 'rejected', reason: 'no' }).success).toBe(true)
  })

  test('the pre-existing rules survive the diff', () => {
    expect(issuePaths({ disposition: 'edited', reason: 'why', selectedOptionId: 'advance' })).toContain('payload')
    expect(issuePaths({ disposition: 'rejected' })).toContain('reason')
    expect(issuePaths({ disposition: 'edited', payload: {}, selectedOptionId: 'advance' })).toContain('reason')
  })
})

/** Minimal in-memory EntityManager fake. See dispose-correction-hook.test.ts. */
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
    fork() {
      return em
    },
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
        const store = storeFor((row as { __entity?: unknown }).__entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

function seed(storeFor: (entity: unknown) => Array<Record<string, unknown>>) {
  storeFor(AgentRun).push({ __entity: AgentRun, id: RUN_ID, tenantId: TENANT, organizationId: ORG, input: {} })
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
    selectedOptionId: null,
    confidence: 0.7,
    payload: PAYLOAD,
    updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    deletedAt: null,
  }
  storeFor(AgentProposal).push(proposal)
  return proposal
}

function makeCtx(em: EntityManager): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'commandBus') return { execute: async () => ({ result: {} }) }
        throw new Error(`[internal] unexpected resolve(${name})`)
      },
    },
    request: new Request('http://test/dispose', { method: 'POST' }),
  } as unknown as CommandRuntimeContext
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('[internal] expected the dispose command to reject')
}

describe('dispose command — the option must be one the agent offered', () => {
  test('an unknown option id is a typed 400 naming the ids that DO exist', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)

    const error = await captureError(() =>
      disposeProposalCommand.execute(
        {
          proposalId: PROPOSAL_ID,
          tenantId: TENANT,
          organizationId: ORG,
          userId: USER,
          disposition: 'approved',
          selectedOptionId: 'never_offered',
        },
        makeCtx(em),
      ),
    )

    expect(isCrudHttpError(error)).toBe(true)
    const crudError = error as { status: number; body: { error: string; details: Record<string, unknown> } }
    expect(crudError.status).toBe(400)
    expect(crudError.body.details).toEqual({
      selectedOptionId: 'never_offered',
      knownOptionIds: ['advance', 'hold'],
    })
    expect(storeFor(AgentProposal)[0].disposition).toBe('pending')
  })

  test('approving a real option records the choice and re-derives the envelope confidence from it', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)

    const result = await disposeProposalCommand.execute(
      {
        proposalId: PROPOSAL_ID,
        tenantId: TENANT,
        organizationId: ORG,
        userId: USER,
        disposition: 'approved',
        selectedOptionId: 'hold',
      },
      makeCtx(em),
    )

    expect(result.selectedOptionId).toBe('hold')
    const stored = storeFor(AgentProposal)[0]
    expect(stored.disposition).toBe('approved')
    expect(stored.selectedOptionId).toBe('hold')
    // The indexed float the low-confidence facet reads follows the CHOSEN option.
    expect(stored.confidence).toBe(0.3)
  })

  test('an EDIT names an option from the ORIGINAL payload, not one invented in the edit', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)

    const error = await captureError(() =>
      disposeProposalCommand.execute(
        {
          proposalId: PROPOSAL_ID,
          tenantId: TENANT,
          organizationId: ORG,
          userId: USER,
          disposition: 'edited',
          reason: 'wrong stage',
          payload: { options: [{ id: 'invented', label: 'Invented', actions: [ACTION] }] },
          selectedOptionId: 'invented',
        },
        makeCtx(em),
      ),
    )

    expect(isCrudHttpError(error)).toBe(true)
    expect((error as { status: number }).status).toBe(400)
  })

  test('a reject carrying an option id is refused by the schema, before any write', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)

    await captureError(() =>
      disposeProposalCommand.execute(
        {
          proposalId: PROPOSAL_ID,
          tenantId: TENANT,
          organizationId: ORG,
          userId: USER,
          disposition: 'rejected',
          reason: 'not actionable',
          selectedOptionId: 'advance',
        },
        makeCtx(em),
      ),
    )

    expect(storeFor(AgentProposal)[0].disposition).toBe('pending')
  })
})
