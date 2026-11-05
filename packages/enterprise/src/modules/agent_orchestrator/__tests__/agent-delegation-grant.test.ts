import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AgentDelegationGrant, AgentPrincipal } from '../data/entities'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => null),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => {}),
}))

import { revokeGrantCommand } from '../commands/grants'
import {
  createAgentDelegationGrant,
  resolveAgentDelegationGrant,
  isGrantActive,
} from '../lib/identity/agentDelegationGrantService'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ORG_B = '88888888-8888-4888-8888-888888888888'
const USER = '33333333-3333-4333-8333-333333333333'
const HUMAN = '66666666-6666-4666-8666-666666666666'
const PRINCIPAL_ID = '44444444-4444-4444-8444-444444444444'
const AGENT_USER = '77777777-7777-4777-8777-777777777777'
const GRANT_ID = '55555555-5555-4555-8555-555555555555'

function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0
  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, v]) => (v === null ? row[k] == null : row[k] === v))
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

function makeContainer(em: EntityManager) {
  return {
    resolve(name: string) {
      if (name === 'em') return em
      throw new Error(`[internal] unexpected resolve(${name})`)
    },
  } as unknown as AwilixContainer
}

function makeCtx(em: EntityManager, headers?: Record<string, string>): CommandRuntimeContext {
  return {
    container: makeContainer(em),
    request: new Request('http://test/revoke', { method: 'POST', headers }),
  } as unknown as CommandRuntimeContext
}

function seedPrincipal(storeFor: (entity: unknown) => Array<Record<string, unknown>>) {
  storeFor(AgentPrincipal).push({
    __entity: AgentPrincipal,
    id: PRINCIPAL_ID,
    tenantId: TENANT,
    organizationId: ORG,
    userId: AGENT_USER,
    agentDefinitionId: 'deals.health_check',
    credentialMode: 'oauth_client',
    enabled: true,
    deletedAt: null,
  })
}

function seedGrant(
  storeFor: (entity: unknown) => Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
) {
  const grant: Record<string, unknown> = {
    __entity: AgentDelegationGrant,
    id: GRANT_ID,
    tenantId: TENANT,
    organizationId: ORG,
    agentPrincipalId: PRINCIPAL_ID,
    agentUserId: AGENT_USER,
    delegatorUserId: HUMAN,
    scopes: ['deals:read'],
    revokedAt: null,
    expiresAt: null,
    createdAt: new Date('2026-06-24T00:00:00.000Z'),
    updatedAt: new Date('2026-06-24T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
  storeFor(AgentDelegationGrant).push(grant)
  return grant
}

describe('AgentDelegationGrant service', () => {
  it('creates an org-scoped grant linked to the principal + delegator', async () => {
    const { em, storeFor } = createFakeEm()
    seedPrincipal(storeFor)
    const grant = await createAgentDelegationGrant(
      makeContainer(em),
      { tenantId: TENANT, organizationId: ORG },
      { agentPrincipalId: PRINCIPAL_ID, delegatorUserId: HUMAN, scopes: ['deals:read', 'deals:propose'] },
    )
    expect(grant.tenantId).toBe(TENANT)
    expect(grant.organizationId).toBe(ORG)
    expect(grant.agentUserId).toBe(AGENT_USER)
    expect(grant.delegatorUserId).toBe(HUMAN)
    expect(grant.scopes).toEqual(['deals:read', 'deals:propose'])
    expect(grant.revokedAt).toBeNull()
  })

  it('refuses to create a grant for a principal in another org (tenant isolation)', async () => {
    const { em, storeFor } = createFakeEm()
    seedPrincipal(storeFor) // principal lives in ORG
    await expect(
      createAgentDelegationGrant(
        makeContainer(em),
        { tenantId: TENANT, organizationId: ORG_B },
        { agentPrincipalId: PRINCIPAL_ID, delegatorUserId: HUMAN, scopes: ['deals:read'] },
      ),
    ).rejects.toThrow(/agent principal not found/)
  })

  it('resolve returns null for a grant in another org', async () => {
    const { em, storeFor } = createFakeEm()
    seedGrant(storeFor)
    const found = await resolveAgentDelegationGrant(makeContainer(em), { tenantId: TENANT, organizationId: ORG_B }, GRANT_ID)
    expect(found).toBeNull()
  })

  it('isGrantActive reflects revoked + expired state', () => {
    const active = { revokedAt: null, expiresAt: null } as unknown as AgentDelegationGrant
    expect(isGrantActive(active)).toBe(true)
    const revoked = { revokedAt: new Date(), expiresAt: null } as unknown as AgentDelegationGrant
    expect(isGrantActive(revoked)).toBe(false)
    const expired = { revokedAt: null, expiresAt: new Date(Date.now() - 1000) } as unknown as AgentDelegationGrant
    expect(isGrantActive(expired)).toBe(false)
  })
})

describe('revoke grant command (Wave 4 Phase 3)', () => {
  it('sets revokedAt + revokedByUserId (happy path)', async () => {
    const { em, storeFor } = createFakeEm()
    seedGrant(storeFor)
    const result = await revokeGrantCommand.execute(
      { grantId: GRANT_ID, tenantId: TENANT, organizationId: ORG, userId: USER },
      makeCtx(em),
    )
    expect(result.grantId).toBe(GRANT_ID)
    expect(result.revokedAt).toBeTruthy()
    const grant = storeFor(AgentDelegationGrant)[0]
    expect(grant.revokedAt).toBeInstanceOf(Date)
    expect(grant.revokedByUserId).toBe(USER)
  })

  it('is idempotent when already revoked', async () => {
    const { em, storeFor } = createFakeEm()
    const revokedAt = new Date('2026-06-20T00:00:00.000Z')
    seedGrant(storeFor, { revokedAt })
    const result = await revokeGrantCommand.execute(
      { grantId: GRANT_ID, tenantId: TENANT, organizationId: ORG, userId: USER },
      makeCtx(em),
    )
    expect(result.revokedAt).toBe(revokedAt.toISOString())
  })

  it('returns a structured 409 on a stale expected updatedAt (optimistic lock)', async () => {
    const { em, storeFor } = createFakeEm()
    seedGrant(storeFor) // current updatedAt = 2026-06-24
    let caught: unknown
    try {
      await revokeGrantCommand.execute(
        {
          grantId: GRANT_ID,
          tenantId: TENANT,
          organizationId: ORG,
          userId: USER,
          expectedUpdatedAt: '2026-06-01T00:00:00.000Z', // stale
        },
        makeCtx(em, { [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-06-01T00:00:00.000Z' }),
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as { status: number }).status).toBe(409)
  })

  it('returns 404 for a grant in another tenant (no expected token)', async () => {
    const { em, storeFor } = createFakeEm()
    seedGrant(storeFor) // grant in ORG
    let caught: unknown
    try {
      await revokeGrantCommand.execute(
        { grantId: GRANT_ID, tenantId: TENANT, organizationId: ORG_B, userId: USER },
        makeCtx(em),
      )
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as { status: number }).status).toBe(404)
  })
})
