/** @jest-environment node */
// Regression: client-id enumeration through the /identity/token response timing.
// verifyClientCredentials answered an unknown or secret-less client id after a
// single indexed lookup while a real one paid for a bcrypt compare, so latency
// alone revealed which client ids exist. Every rejecting path MUST now run one
// bcrypt compare via the same `api_keys` primitive the real path uses.
//
// Asserted on the mocked collaborator rather than on wall-clock time: a timing
// assertion is inherently flaky, while "the compare ran" is the deterministic
// property that makes the timings match.
import type { AwilixContainer } from 'awilix'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { AgentDelegationGrant, AgentPrincipal } from '../data/entities'

const verifyApiKey = jest.fn()
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  createApiKey: jest.fn(),
  verifyApiKey: (...args: unknown[]) => verifyApiKey(...args),
}))

import { issueAgentToken } from '../lib/identity/agentTokenService'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const AGENT_USER = '66666666-6666-4666-8666-666666666666'
const HUMAN = '55555555-5555-4555-8555-555555555555'
const CLIENT_SECRET = 'omk_abcd1234.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const REAL_KEY_HASH = '$2b$10$RealCandidateHashRealCandidateHashRealCandidateHashRea'

function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  let idSeq = 0
  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) =>
      value === null ? row[key] === null || row[key] === undefined : row[key] === value,
    )
  }
  const em = {
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
    fork() {
      return em
    },
    __seed(entity: unknown, row: Record<string, unknown>) {
      const suffix = (++idSeq).toString(16).padStart(12, '0')
      if (!row.id) row.id = `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`
      storeFor(entity).push(row)
      return row
    },
  }
  return em
}

function createContainer(em: ReturnType<typeof createFakeEm>): AwilixContainer {
  return {
    resolve(name: string) {
      if (name === 'em') return em
      throw new Error(`[test] unexpected resolve(${name})`)
    },
  } as unknown as AwilixContainer
}

function seedPrincipal(em: ReturnType<typeof createFakeEm>): AgentPrincipal {
  return em.__seed(AgentPrincipal, {
    tenantId: TENANT,
    organizationId: ORG,
    userId: AGENT_USER,
    agentDefinitionId: 'deals.health_check',
    roleId: 'role-1',
    credentialMode: 'oauth_client',
    enabled: true,
    deletedAt: null,
  }) as unknown as AgentPrincipal
}

function seedClientSecret(
  em: ReturnType<typeof createFakeEm>,
  principal: AgentPrincipal,
  expiresAt: Date | null = null,
) {
  return em.__seed(ApiKey, {
    name: `__agent_oauth_client__${principal.id}__`,
    createdBy: principal.userId,
    organizationId: ORG,
    tenantId: TENANT,
    keyHash: REAL_KEY_HASH,
    keyPrefix: CLIENT_SECRET.slice(0, 12),
    deletedAt: null,
    expiresAt,
  })
}

function seedGrant(em: ReturnType<typeof createFakeEm>, principal: AgentPrincipal) {
  return em.__seed(AgentDelegationGrant, {
    tenantId: TENANT,
    organizationId: ORG,
    agentPrincipalId: principal.id,
    agentUserId: principal.userId,
    delegatorUserId: HUMAN,
    scopes: ['deals:read'],
    revokedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    deletedAt: null,
  })
}

describe('verifyClientCredentials timing equalization', () => {
  beforeEach(() => {
    verifyApiKey.mockReset()
    verifyApiKey.mockResolvedValue(false)
  })

  it('runs a bcrypt compare against a fixed dummy hash for an unknown client id', async () => {
    const em = createFakeEm()

    const result = await issueAgentToken(createContainer(em), {
      clientId: '99999999-9999-4999-8999-999999999999',
      clientSecret: CLIENT_SECRET,
    })

    expect(result).toBeNull()
    expect(verifyApiKey).toHaveBeenCalledTimes(1)
    expect(verifyApiKey.mock.calls[0][0]).toBe(CLIENT_SECRET)
    expect(verifyApiKey.mock.calls[0][1]).toMatch(/^\$2[aby]\$10\$/)
    expect(verifyApiKey.mock.calls[0][1]).not.toBe(REAL_KEY_HASH)
  })

  it('runs a bcrypt compare when a known principal has no stored client secret', async () => {
    const em = createFakeEm()
    const principal = seedPrincipal(em)
    seedGrant(em, principal)

    const result = await issueAgentToken(createContainer(em), {
      clientId: principal.id,
      clientSecret: CLIENT_SECRET,
    })

    expect(result).toBeNull()
    expect(verifyApiKey).toHaveBeenCalledTimes(1)
    expect(verifyApiKey.mock.calls[0][1]).toMatch(/^\$2[aby]\$10\$/)
  })

  it('runs a bcrypt compare when every stored client secret has expired', async () => {
    const em = createFakeEm()
    const principal = seedPrincipal(em)
    seedClientSecret(em, principal, new Date(Date.now() - 60_000))
    seedGrant(em, principal)

    const result = await issueAgentToken(createContainer(em), {
      clientId: principal.id,
      clientSecret: CLIENT_SECRET,
    })

    expect(result).toBeNull()
    expect(verifyApiKey).toHaveBeenCalledTimes(1)
    expect(verifyApiKey.mock.calls[0][1]).not.toBe(REAL_KEY_HASH)
  })

  it('compares against the real candidate hash when a live secret exists', async () => {
    const em = createFakeEm()
    const principal = seedPrincipal(em)
    seedClientSecret(em, principal)
    seedGrant(em, principal)

    await issueAgentToken(createContainer(em), {
      clientId: principal.id,
      clientSecret: CLIENT_SECRET,
    })

    expect(verifyApiKey).toHaveBeenCalledTimes(1)
    expect(verifyApiKey).toHaveBeenCalledWith(CLIENT_SECRET, REAL_KEY_HASH)
  })

  it('never authenticates an unknown client even if the dummy compare resolves true', async () => {
    verifyApiKey.mockResolvedValue(true)
    const em = createFakeEm()

    const unknownClient = await issueAgentToken(createContainer(em), {
      clientId: '99999999-9999-4999-8999-999999999999',
      clientSecret: CLIENT_SECRET,
    })
    expect(unknownClient).toBeNull()

    const principal = seedPrincipal(em)
    seedGrant(em, principal)
    const secretlessPrincipal = await issueAgentToken(createContainer(em), {
      clientId: principal.id,
      clientSecret: CLIENT_SECRET,
    })
    expect(secretlessPrincipal).toBeNull()
  })
})
