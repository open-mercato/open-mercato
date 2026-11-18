/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { resolveAgentPrincipal } from '../lib/identity/agentPrincipalService'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

const issueAgentToken = jest.fn()
jest.mock('../lib/identity/agentTokenService', () => ({
  ...jest.requireActual('../lib/identity/agentTokenService'),
  issueAgentToken: (...args: unknown[]) => issueAgentToken(...args),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { metadata as tokenMetadata, POST as tokenPOST } from '../api/identity/token/route'
import { metadata as agentAuthMetadata, POST as agentAuthPOST } from '../api/identity/agent/auth/route'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const TENANT_B = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'
const CLIENT_ID = '55555555-5555-4555-8555-555555555555'

function postRequest(body: unknown) {
  return new Request('http://test/api/agent_orchestrator/identity/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('the OAuth identity routes are public token endpoints', () => {
  beforeEach(() => {
    issueAgentToken.mockReset()
  })

  it('declares requireAuth false so the dispatcher does not demand a staff session', () => {
    expect(tokenMetadata.POST).toEqual({ requireAuth: false })
    expect(agentAuthMetadata.POST).toEqual({ requireAuth: false })
  })

  it('rejects bad client credentials with a single minimal 401', async () => {
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      hasRegistration: () => false,
      resolve: () => {
        throw new Error('[test] unexpected resolve')
      },
    } as unknown as AwilixContainer)
    issueAgentToken.mockResolvedValue(null)
    const response = await tokenPOST(
      postRequest({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: 'wrong' }),
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_client' })
  })

  it('applies the per-IP rate limit before any credential work', async () => {
    const consume = jest.fn(async () => ({ allowed: false, msBeforeNext: 1000 }))
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      hasRegistration: () => true,
      resolve: () => ({ consume }),
    } as unknown as AwilixContainer)
    const response = await tokenPOST(
      postRequest({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: 'wrong' }),
    )
    expect([429, 503]).toContain(response.status)
    expect(issueAgentToken).not.toHaveBeenCalled()
  })

  it('rejects an unverifiable assertion on the agent auth route', async () => {
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      hasRegistration: () => false,
      resolve: () => {
        throw new Error('[test] unexpected resolve')
      },
    } as unknown as AwilixContainer)
    const response = await agentAuthPOST(
      postRequest({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: 'not-a-jwt' }),
    )
    expect(response.status).toBe(401)
  })
})

describe('resolveAgentPrincipal scoping', () => {
  type Row = Record<string, unknown>
  function containerWith(rows: Row[]) {
    const em = {
      fork: () => em,
      findOne: async (_entity: unknown, where: Row) =>
        rows.find((row) => Object.entries(where).every(([key, value]) => (
          value === null ? (row[key] ?? null) === null : row[key] === value
        ))) ?? null,
    }
    return { resolve: () => em } as unknown as AwilixContainer
  }
  const baseRow: Row = {
    tenantId: TENANT_A,
    organizationId: ORG_A,
    agentDefinitionId: 'deals.health_check',
    enabled: true,
    deletedAt: null,
  }

  it('resolves the principal inside its own tenant and organization', async () => {
    const result = await resolveAgentPrincipal(
      containerWith([baseRow]),
      { tenantId: TENANT_A, organizationId: ORG_A },
      'deals.health_check',
    )
    expect(result).toBe(baseRow)
  })

  it('returns nothing for another tenant, even with the same organization id', async () => {
    const result = await resolveAgentPrincipal(
      containerWith([baseRow]),
      { tenantId: TENANT_B, organizationId: ORG_A },
      'deals.health_check',
    )
    expect(result).toBeNull()
  })

  it('returns nothing for another organization', async () => {
    const result = await resolveAgentPrincipal(
      containerWith([baseRow]),
      { tenantId: TENANT_A, organizationId: ORG_B },
      'deals.health_check',
    )
    expect(result).toBeNull()
  })

  it('does not resolve a disabled principal', async () => {
    const result = await resolveAgentPrincipal(
      containerWith([{ ...baseRow, enabled: false }]),
      { tenantId: TENANT_A, organizationId: ORG_A },
      'deals.health_check',
    )
    expect(result).toBeNull()
  })
})
