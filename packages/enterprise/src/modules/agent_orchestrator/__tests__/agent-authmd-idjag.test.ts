import type { AwilixContainer } from 'awilix'
import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { AgentDelegationGrant, AgentPrincipal } from '../data/entities'
import { AGENT_TOKEN_AUDIENCE } from '../lib/identity/agentTokenService'

// Mock the principal provisioning so the ID-JAG onboarding test exercises the
// assertion validation + grant find-or-create + shared mint path without standing
// up the auth User/Role provisioning (covered by its own suite). The mock is
// idempotent on (org, agentDefinitionId): the SAME principal is returned for a
// repeat call so re-registration cannot create a duplicate.
const provisionCalls: Array<{ organizationId: string; agentDefinitionId: string; credentialMode: string }> = []
const principalsByKey = new Map<string, AgentPrincipal>()
let principalSeq = 0

jest.mock('../lib/identity/agentPrincipalService', () => ({
  provisionAgentPrincipal: jest.fn(
    async (
      _container: unknown,
      scope: { tenantId: string; organizationId: string },
      input: { agentDefinitionId: string; credentialMode: string },
    ) => {
      provisionCalls.push({
        organizationId: scope.organizationId,
        agentDefinitionId: input.agentDefinitionId,
        credentialMode: input.credentialMode,
      })
      const key = `${scope.organizationId}::${input.agentDefinitionId}`
      let principal = principalsByKey.get(key)
      if (!principal) {
        const n = (++principalSeq).toString(16).padStart(12, '0')
        principal = {
          id: `99999999-9999-4999-8999-${n}`,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: `88888888-8888-4888-8888-${n}`,
          agentDefinitionId: input.agentDefinitionId,
          roleId: `role-${n}`,
          credentialMode: input.credentialMode,
          enabled: true,
        } as unknown as AgentPrincipal
        principalsByKey.set(key, principal)
      }
      return {
        principal,
        userId: principal.userId,
        roleId: principal.roleId,
        interactiveLoginDisabled: true,
      }
    },
  ),
}))

import {
  AGENT_ASSERTION_AUDIENCE,
  getAgentAuthDiscovery,
  registerAgentViaIdJag,
  verifyIdJagAssertion,
} from '../lib/identity/agentAuthMdService'

const ISSUER = 'https://idp.example.com'
const ISSUER_SECRET = 'issuer-shared-hs256-secret'
const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const HUMAN = '55555555-5555-4555-8555-555555555555'

function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending = new Set<Record<string, unknown>>()
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
        if (!row.id) {
          const n = (++idSeq).toString(16).padStart(12, '0')
          row.id = `aaaaaaaa-aaaa-4aaa-8aaa-${n}`
        }
        const store = storeFor((row as { __entity?: unknown }).__entity)
        if (!store.includes(row)) store.push(row)
        pending.delete(row)
      }
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where))
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

/** Sign an ID-JAG assertion the way a trusted issuer would (HS256, issuer secret). */
function signAssertion(
  claims: Record<string, unknown>,
  opts: { secret?: string; audience?: string; issuer?: string } = {},
): string {
  return signJwt(claims, {
    secret: opts.secret ?? ISSUER_SECRET,
    audience: opts.audience ?? AGENT_ASSERTION_AUDIENCE,
    issuer: opts.issuer ?? ISSUER,
    expiresInSec: 300,
  })
}

function baseClaims(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'external-agent-subject-1',
    tenant_id: TENANT_A,
    org_id: ORG_A,
    agent_definition_id: 'deals.health_check',
    delegator_user_id: HUMAN,
    scopes: ['deals:read', 'deals:propose'],
    display_name: 'External Deals Agent',
    ...overrides,
  }
}

describe('auth.md / ID-JAG self-registration (Wave 4 Phase 4)', () => {
  const prevSecret = process.env.JWT_SECRET
  const prevIssuers = process.env.AGENT_ID_JAG_ISSUERS
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-idjag'
    process.env.AGENT_ID_JAG_ISSUERS = JSON.stringify([
      { issuer: ISSUER, secret: ISSUER_SECRET, allowedOrganizationIds: [ORG_A] },
    ])
    provisionCalls.length = 0
    principalsByKey.clear()
    principalSeq = 0
  })
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = prevSecret
    if (prevIssuers === undefined) delete process.env.AGENT_ID_JAG_ISSUERS
    else process.env.AGENT_ID_JAG_ISSUERS = prevIssuers
  })

  describe('discovery (/.well-known)', () => {
    it('advertises the endpoints + grant types and contains no secrets', () => {
      const meta = getAgentAuthDiscovery()
      expect(meta.token_endpoint).toBe('/api/agent_orchestrator/identity/token')
      expect(meta.agent_auth_endpoint).toBe('/api/agent_orchestrator/identity/agent/auth')
      expect(meta.grant_types_supported).toContain('client_credentials')
      expect(meta.grant_types_supported).toContain('urn:ietf:params:oauth:grant-type:jwt-bearer')
      expect(meta.token_audience).toBe(AGENT_TOKEN_AUDIENCE)
      expect(meta.agent_assertion_audience).toBe(AGENT_ASSERTION_AUDIENCE)
      // No secret material leaks through discovery (the configured issuer secret,
      // the base JWT secret, and any JWKS verification material are all absent).
      const serialized = JSON.stringify(meta)
      expect(serialized).not.toContain(ISSUER_SECRET)
      expect(serialized).not.toContain(process.env.JWT_SECRET!)
      expect(serialized).not.toContain('jwks')
    })
  })

  describe('verifyIdJagAssertion', () => {
    it('accepts a valid issuer-signed assertion targeting the assertion audience', () => {
      const claims = verifyIdJagAssertion(signAssertion(baseClaims()))
      expect(claims).not.toBeNull()
      expect(claims!.iss).toBe(ISSUER)
      expect(claims!.org_id).toBe(ORG_A)
      expect(claims!.agent_definition_id).toBe('deals.health_check')
    })

    it('rejects a forged assertion signed with the wrong secret', () => {
      const forged = signAssertion(baseClaims(), { secret: 'attacker-secret' })
      expect(verifyIdJagAssertion(forged)).toBeNull()
    })

    it('rejects an assertion from an unknown issuer (no info leak)', () => {
      const other = signAssertion(baseClaims({}), { issuer: 'https://evil.example.com' })
      expect(verifyIdJagAssertion(other)).toBeNull()
    })

    it('rejects a wrong-audience assertion', () => {
      const wrongAud = signAssertion(baseClaims(), { audience: 'staff' })
      expect(verifyIdJagAssertion(wrongAud)).toBeNull()
    })

    it('rejects every assertion when no trusted issuer is configured (fail closed)', () => {
      delete process.env.AGENT_ID_JAG_ISSUERS
      expect(verifyIdJagAssertion(signAssertion(baseClaims()))).toBeNull()
    })

    it('rejects an assertion for an org the issuer is not authorized for', () => {
      // Issuer is pinned to ORG_A; an assertion for ORG_B is rejected.
      const claims = verifyIdJagAssertion(signAssertion(baseClaims({ org_id: ORG_B, tenant_id: TENANT_A })))
      expect(claims).toBeNull()
    })
  })

  describe('registerAgentViaIdJag', () => {
    it('onboards a scoped authmd principal + grant and mints a revocable token (happy path)', async () => {
      const em = createFakeEm()
      const claims = verifyIdJagAssertion(signAssertion(baseClaims()))!
      const result = await registerAgentViaIdJag(createContainer(em), claims)

      expect(result).not.toBeNull()
      expect(result!.principal.credentialMode).toBe('authmd')
      // The grant carries the ID-JAG seam columns.
      expect(result!.grant.issuer).toBe(ISSUER)
      expect(result!.grant.subject).toBe('external-agent-subject-1')
      expect(result!.grant.audience).toBe(AGENT_ASSERTION_AUDIENCE)
      expect(result!.grant.agentPrincipalId).toBe(result!.principal.id)
      expect(result!.grant.delegatorUserId).toBe(HUMAN)

      // The minted token is an agent-audience JWT carrying the server-derived org.
      const decoded = verifyJwt(result!.token.accessToken, { audience: AGENT_TOKEN_AUDIENCE })
      expect(decoded).not.toBeNull()
      expect(decoded!.organizationId).toBe(ORG_A)
      expect(decoded!.tenantId).toBe(TENANT_A)
      expect(decoded!.sub).toBe(result!.principal.userId)
      expect(decoded!.obo).toBe(HUMAN)
      expect(result!.token.scope).toBe('deals:read deals:propose')
    })

    it('is idempotent: re-presenting the same issuer+subject reuses the principal + grant (no dupes)', async () => {
      const em = createFakeEm()
      const claims = verifyIdJagAssertion(signAssertion(baseClaims()))!
      const first = await registerAgentViaIdJag(createContainer(em), claims)
      const second = await registerAgentViaIdJag(createContainer(em), claims)

      expect(first!.principal.id).toBe(second!.principal.id)
      expect(first!.grant.id).toBe(second!.grant.id)
      // Exactly one grant row exists for this (org, principal, issuer, subject).
      expect(em.__stores.get(AgentDelegationGrant)!.length).toBe(1)
      // Only one distinct principal was provisioned across both calls.
      const principalKeys = new Set(provisionCalls.map((c) => `${c.organizationId}::${c.agentDefinitionId}`))
      expect(principalKeys.size).toBe(1)
    })

    it('narrows the minted scope to the grant — an unauthorized capability is dropped', async () => {
      const em = createFakeEm()
      const claims = verifyIdJagAssertion(signAssertion(baseClaims({ scopes: ['deals:read'] })))!
      const result = await registerAgentViaIdJag(createContainer(em), claims, 'deals:read orders:delete')
      expect(result!.token.scope).toBe('deals:read')
    })

    it('tenant isolation: distinct orgs onboard distinct principals + grants', async () => {
      // Allow the issuer to provision into both orgs for this case.
      process.env.AGENT_ID_JAG_ISSUERS = JSON.stringify([
        { issuer: ISSUER, secret: ISSUER_SECRET, allowedOrganizationIds: [ORG_A, ORG_B] },
      ])
      const em = createFakeEm()
      const claimsA = verifyIdJagAssertion(signAssertion(baseClaims({ sub: 'sub-a', org_id: ORG_A })))!
      const claimsB = verifyIdJagAssertion(signAssertion(baseClaims({ sub: 'sub-b', org_id: ORG_B })))!
      const resA = await registerAgentViaIdJag(createContainer(em), claimsA)
      const resB = await registerAgentViaIdJag(createContainer(em), claimsB)

      expect(resA!.principal.organizationId).toBe(ORG_A)
      expect(resB!.principal.organizationId).toBe(ORG_B)
      expect(resA!.principal.id).not.toBe(resB!.principal.id)
      expect(resA!.grant.id).not.toBe(resB!.grant.id)

      const tokenA = verifyJwt(resA!.token.accessToken, { audience: AGENT_TOKEN_AUDIENCE })!
      const tokenB = verifyJwt(resB!.token.accessToken, { audience: AGENT_TOKEN_AUDIENCE })!
      expect(tokenA.organizationId).toBe(ORG_A)
      expect(tokenB.organizationId).toBe(ORG_B)
    })

    it('does not resurrect a revoked grant on re-registration', async () => {
      const em = createFakeEm()
      const claims = verifyIdJagAssertion(signAssertion(baseClaims()))!
      const first = await registerAgentViaIdJag(createContainer(em), claims)
      // Revoke the onboarded grant (as the revoke command would).
      ;(first!.grant as unknown as Record<string, unknown>).revokedAt = new Date()

      const second = await registerAgentViaIdJag(createContainer(em), claims)
      expect(second).toBeNull()
    })
  })
})
