import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AgentProposal, AgentRun } from '../data/entities'

/**
 * A verdict must flush the cached proposal reads.
 *
 * `/api/agent_orchestrator/proposals` is a `makeCrudRoute` list, so with
 * `ENABLE_CRUD_API_CACHE=true` its responses are served from cache until a write
 * flushes the resource tags. The factory only flushes them for writes it performs
 * itself, and this verdict is a Command — so without an explicit invalidation the
 * caseload keeps serving the approved proposal as `pending` until the entry
 * expires, and the operator watches the row they just cleared sit in the queue.
 *
 * The tag asserted here is the one the READ side derives (from the ORM class
 * name, since the route configures neither `events` nor `actions`); a rename that
 * moved one side without the other would land here.
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

const invalidateCrudCacheMock = jest.fn(async () => {})
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: (...args: unknown[]) => invalidateCrudCacheMock(...(args as [])),
}))

import { canonicalizeResourceTag } from '@open-mercato/shared/lib/crud/cache'
import { disposeProposalCommand } from '../commands/dispose'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444'
const RUN_ID = '55555555-5555-4555-8555-555555555555'

const PAYLOAD = {
  options: [{ id: 'advance', label: 'Advance', confidence: 0.7, actions: [{ type: 'set_stage', payload: {} }] }],
}

function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()

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
      return { ...data, __entity: entity }
    },
    persist() {
      return em
    },
    async flush() {},
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
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

describe('dispose command — cached list reads', () => {
  beforeEach(() => {
    invalidateCrudCacheMock.mockClear()
  })

  test('an approve flushes the proposal cache tags the list route reads through', async () => {
    const { em, storeFor } = createFakeEm()
    storeFor(AgentRun).push({ __entity: AgentRun, id: RUN_ID, tenantId: TENANT, organizationId: ORG, input: {} })
    storeFor(AgentProposal).push({
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
    })

    await disposeProposalCommand.execute(
      {
        proposalId: PROPOSAL_ID,
        tenantId: TENANT,
        organizationId: ORG,
        userId: USER,
        disposition: 'approved',
        selectedOptionId: 'advance',
      },
      makeCtx(em),
    )

    expect(invalidateCrudCacheMock).toHaveBeenCalledTimes(1)
    const [, resource, identifiers, fallbackTenant] = invalidateCrudCacheMock.mock.calls[0] as unknown as [
      unknown,
      string,
      Record<string, unknown>,
      string | null,
    ]
    expect(resource).toBe(canonicalizeResourceTag(AgentProposal.name))
    expect(identifiers).toMatchObject({ id: PROPOSAL_ID, tenantId: TENANT, organizationId: ORG })
    expect(fallbackTenant).toBe(TENANT)
  })
})
