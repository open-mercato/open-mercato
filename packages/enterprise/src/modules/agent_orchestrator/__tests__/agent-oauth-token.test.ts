import type { AwilixContainer } from 'awilix'
import { hash } from 'bcryptjs'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { AgentDelegationGrant, AgentPrincipal } from '../data/entities'
import {
  issueAgentToken,
  verifyAgentToken,
  AGENT_TOKEN_AUDIENCE,
} from '../lib/identity/agentTokenService'
import { verifyJwt } from '@open-mercato/shared/lib/auth/jwt'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const TENANT_B = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'
const HUMAN = '55555555-5555-4555-8555-555555555555'
const AGENT_USER_A = '66666666-6666-4666-8666-666666666666'
const AGENT_USER_B = '77777777-7777-4777-8777-777777777777'

/**
 * In-memory EM fake covering the surface the token/grant services use
 * (find/findOne with simple equality, create/persist/flush, orderBy DESC on
 * createdAt). Lets us exercise real bcrypt + real JWT signing without a DB.
 */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending = new Set<Record<string, unknown>>()
  let idSeq = 0
  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matchValue(rowValue: unknown, condition: unknown): boolean {
    if (condition === null) return rowValue === null || rowValue === undefined
    return rowValue === condition
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, v]) => matchValue(row[k], v))
  }
  const em = {
    create(entity: unknown, data: Record<string, unknown>) {
      const row: Record<string, unknown> = { ...data }
      ;(row as { __entity?: unknown }).__entity = entity
      return row
    },
    persist(row: Record<string, unknown>) {
      pending.add(row)
      return em
    },
    async flush() {
      for (const row of Array.from(pending)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const store = storeFor((row as { __entity?: unknown }).__entity)
        if (!store.includes(row)) store.push(row)
        pending.delete(row)
      }
    },
    async findOne(
      entity: unknown,
      where: Record<string, unknown>,
      opts?: { orderBy?: Record<string, 'ASC' | 'DESC'> },
    ) {
      const found = storeFor(entity).filter((row) => matches(row, where))
      if (opts?.orderBy?.createdAt === 'DESC') {
        found.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
      }
      return found[0] ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
    fork() {
      return em
    },
    __seed(entity: unknown, row: Record<string, unknown>) {
      ;(row as { __entity?: unknown }).__entity = entity
      // UUID-shaped ids so they satisfy the agentTokenClaimsSchema uuid() checks.
      if (!row.id) {
        const n = (++idSeq).toString(16).padStart(12, '0')
        row.id = `aaaaaaaa-aaaa-4aaa-8aaa-${n}`
      }
      storeFor(entity).push(row)
      return row
    },
    __stores: stores,
  }
  return em
}

function createContainer(em: ReturnType<typeof createFakeEm>) {
  return {
    resolve(name: string) {
      if (name === 'em') return em
      throw new Error(`[test] unexpected resolve(${name})`)
    },
  } as unknown as AwilixContainer
}

const CLIENT_SECRET = 'omk_abcd1234.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

async function seedPrincipalWithSecret(
  em: ReturnType<typeof createFakeEm>,
  opts: { tenantId: string; organizationId: string; agentUserId: string; clientSecret?: string },
) {
  const principal = em.__seed(AgentPrincipal, {
    tenantId: opts.tenantId,
    organizationId: opts.organizationId,
    userId: opts.agentUserId,
    agentDefinitionId: 'deals.health_check',
    roleId: 'role-1',
    credentialMode: 'oauth_client',
    enabled: true,
    deletedAt: null,
  }) as unknown as AgentPrincipal
  const keyHash = await hash(opts.clientSecret ?? CLIENT_SECRET, 10)
  em.__seed(ApiKey, {
    name: `__agent_oauth_client__${principal.id}__`,
    createdBy: opts.agentUserId,
    organizationId: opts.organizationId,
    tenantId: opts.tenantId,
    keyHash,
    keyPrefix: (opts.clientSecret ?? CLIENT_SECRET).slice(0, 12),
    deletedAt: null,
    expiresAt: null,
  })
  return principal
}

function seedGrant(
  em: ReturnType<typeof createFakeEm>,
  principal: AgentPrincipal,
  opts: { scopes: string[]; revokedAt?: Date | null; expiresAt?: Date | null } = { scopes: ['deals:read'] },
) {
  return em.__seed(AgentDelegationGrant, {
    tenantId: principal.tenantId,
    organizationId: principal.organizationId,
    agentPrincipalId: principal.id,
    agentUserId: principal.userId,
    delegatorUserId: HUMAN,
    scopes: opts.scopes,
    revokedAt: opts.revokedAt ?? null,
    expiresAt: opts.expiresAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }) as unknown as AgentDelegationGrant
}

describe('agent OAuth client-credentials token server (Wave 4 Phase 3)', () => {
  const prevSecret = process.env.JWT_SECRET
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-agent-oauth'
  })
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = prevSecret
  })

  it('mints a scoped, audience-bound JWT bound to the principal + grant (happy path)', async () => {
    const em = createFakeEm()
    const principal = await seedPrincipalWithSecret(em, {
      tenantId: TENANT_A,
      organizationId: ORG_A,
      agentUserId: AGENT_USER_A,
    })
    const grant = seedGrant(em, principal, { scopes: ['deals:read', 'deals:propose'] })

    const result = await issueAgentToken(createContainer(em), {
      clientId: principal.id,
      clientSecret: CLIENT_SECRET,
    })

    expect(result).not.toBeNull()
    expect(result!.grantId).toBe(grant.id)
    expect(result!.scope).toBe('deals:read deals:propose')
    expect(result!.expiresInSeconds).toBeGreaterThan(0)

    // The verified token re-checks the grant per request and exposes the actor +
    // on-behalf-of attribution from the signed claims.
    const verified = await verifyAgentToken(createContainer(em), result!.accessToken)
    expect(verified).not.toBeNull()
    expect(verified!.actorUserId).toBe(AGENT_USER_A)
    expect(verified!.onBehalfOfUserId).toBe(HUMAN)
    expect(verified!.scopes).toEqual(['deals:read', 'deals:propose'])
  })

  it('narrows (never widens) scope to the grant — an unauthorized capability is dropped', async () => {
    const em = createFakeEm()
    const principal = await seedPrincipalWithSecret(em, {
      tenantId: TENANT_A,
      organizationId: ORG_A,
      agentUserId: AGENT_USER_A,
    })
    seedGrant(em, principal, { scopes: ['deals:read'] })

    const result = await issueAgentToken(createContainer(em), {
      clientId: principal.id,
      clientSecret: CLIENT_SECRET,
      requestedScope: 'deals:read orders:delete', // orders:delete is NOT granted
    })
    expect(result!.scope).toBe('deals:read')
  })

  it('returns null (→ 401) for an invalid client secret', async () => {
    const em = createFakeEm()
    const principal = await seedPrincipalWithSecret(em, {
      tenantId: TENANT_A,
      organizationId: ORG_A,
      agentUserId: AGENT_USER_A,
    })
    seedGrant(em, principal)

    const result = await issueAgentToken(createContainer(em), {
      clientId: principal.id,
      clientSecret: 'omk_wrong.0000000000000000000000000000000000000000000000',
    })
    expect(result).toBeNull()
  })

  it('returns null (→ 401) for an unknown client id (no info leak)', async () => {
    const em = createFakeEm()
    const result = await issueAgentToken(createContainer(em), {
      clientId: '99999999-9999-9999-9999-999999999999',
      clientSecret: CLIENT_SECRET,
    })
    expect(result).toBeNull()
  })

  it('refuses to mint when the grant is revoked', async () => {
    const em = createFakeEm()
    const principal = await seedPrincipalWithSecret(em, {
      tenantId: TENANT_A,
      organizationId: ORG_A,
      agentUserId: AGENT_USER_A,
    })
    seedGrant(em, principal, { scopes: ['deals:read'], revokedAt: new Date() })

    const result = await issueAgentToken(createContainer(em), {
      clientId: principal.id,
      clientSecret: CLIENT_SECRET,
    })
    expect(result).toBeNull()
  })

  it('tenant isolation: org B credentials only ever mint an org B-scoped token', async () => {
    const em = createFakeEm()
    // Two principals with the SAME plaintext secret in different orgs.
    const principalA = await seedPrincipalWithSecret(em, {
      tenantId: TENANT_A,
      organizationId: ORG_A,
      agentUserId: AGENT_USER_A,
    })
    seedGrant(em, principalA, { scopes: ['deals:read'] })
    const principalB = await seedPrincipalWithSecret(em, {
      tenantId: TENANT_B,
      organizationId: ORG_B,
      agentUserId: AGENT_USER_B,
    })
    seedGrant(em, principalB, { scopes: ['deals:read'] })

    // Authenticating as principal B yields a token scoped to org B, never org A.
    const result = await issueAgentToken(createContainer(em), {
      clientId: principalB.id,
      clientSecret: CLIENT_SECRET,
    })
    expect(result).not.toBeNull()
    const claims = verifyJwt(result!.accessToken, { audience: AGENT_TOKEN_AUDIENCE })
    expect(claims!.organizationId).toBe(ORG_B)
    expect(claims!.tenantId).toBe(TENANT_B)
  })

  it('revocation is immediate: a token minted before revoke is denied on the NEXT verify', async () => {
    const em = createFakeEm()
    const principal = await seedPrincipalWithSecret(em, {
      tenantId: TENANT_A,
      organizationId: ORG_A,
      agentUserId: AGENT_USER_A,
    })
    const grant = seedGrant(em, principal, { scopes: ['deals:read'] })

    const result = await issueAgentToken(createContainer(em), {
      clientId: principal.id,
      clientSecret: CLIENT_SECRET,
    })
    expect(await verifyAgentToken(createContainer(em), result!.accessToken)).not.toBeNull()

    // Revoke the grant (as the command would) — the token is still cryptographically
    // valid, but the per-request grant check now denies it.
    ;(grant as unknown as Record<string, unknown>).revokedAt = new Date()
    expect(await verifyAgentToken(createContainer(em), result!.accessToken)).toBeNull()
  })

  it('an agent JWT cannot be replayed as a staff session (audience isolation)', async () => {
    const em = createFakeEm()
    const principal = await seedPrincipalWithSecret(em, {
      tenantId: TENANT_A,
      organizationId: ORG_A,
      agentUserId: AGENT_USER_A,
    })
    seedGrant(em, principal, { scopes: ['deals:read'] })
    const result = await issueAgentToken(createContainer(em), {
      clientId: principal.id,
      clientSecret: CLIENT_SECRET,
    })
    // The agent-audience token must NOT verify against the staff audience.
    expect(verifyJwt(result!.accessToken, { audience: 'staff' })).toBeNull()
  })
})
