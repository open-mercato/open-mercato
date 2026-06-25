/** @jest-environment node */
import type { AwilixContainer } from 'awilix'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

// The route delegates onboarding to the auth.md service; mock it so the route test
// focuses on request parsing, the assertion-validation gate, and the response shape.
const verifyIdJagAssertion = jest.fn()
const registerAgentViaIdJag = jest.fn()
jest.mock('../lib/identity/agentAuthMdService', () => {
  const actual = jest.requireActual('../lib/identity/agentAuthMdService')
  return {
    ...actual,
    verifyIdJagAssertion: (...args: unknown[]) => verifyIdJagAssertion(...args),
    registerAgentViaIdJag: (...args: unknown[]) => registerAgentViaIdJag(...args),
  }
})

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { GET as discoveryGET } from '../api/identity/.well-known/route'
import { POST as agentAuthPOST } from '../api/identity/agent/auth/route'

const ORG = '22222222-2222-4222-8222-222222222222'
const TENANT = '11111111-1111-4111-8111-111111111111'
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

beforeEach(() => {
  verifyIdJagAssertion.mockReset()
  registerAgentViaIdJag.mockReset()
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: () => {
      throw new Error('[test] unexpected resolve')
    },
  } as unknown as AwilixContainer)
})

function authRequest(body: unknown) {
  return new Request('http://test/api/agent_orchestrator/identity/agent/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /identity/.well-known (Wave 4 Phase 4)', () => {
  const prev = process.env.JWT_SECRET
  beforeAll(() => {
    process.env.JWT_SECRET = 'test'
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = prev
  })

  it('returns the discovery metadata with no secrets', async () => {
    const res = await discoveryGET()
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.token_endpoint).toBe('/api/agent_orchestrator/identity/token')
    expect(json.agent_auth_endpoint).toBe('/api/agent_orchestrator/identity/agent/auth')
    expect(Array.isArray(json.grant_types_supported)).toBe(true)
    expect((json.grant_types_supported as string[])).toContain(GRANT_TYPE)
    // No secret material leaks (the base JWT secret is absent from discovery).
    expect(JSON.stringify(json)).not.toContain(process.env.JWT_SECRET!)
    expect(JSON.stringify(json)).not.toContain('jwks')
  })
})

describe('POST /identity/agent/auth (Wave 4 Phase 4)', () => {
  it('400 unsupported_grant_type for a non-JWT-bearer grant', async () => {
    const res = await agentAuthPOST(authRequest({ grant_type: 'client_credentials', assertion: 'x.y.z' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('unsupported_grant_type')
    expect(verifyIdJagAssertion).not.toHaveBeenCalled()
  })

  it('400 invalid_request for a malformed body', async () => {
    const res = await agentAuthPOST(authRequest({ grant_type: GRANT_TYPE }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
  })

  it('401 invalid_grant for a forged/invalid assertion', async () => {
    verifyIdJagAssertion.mockReturnValue(null)
    const res = await agentAuthPOST(authRequest({ grant_type: GRANT_TYPE, assertion: 'forged.assertion.sig' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('invalid_grant')
    expect(registerAgentViaIdJag).not.toHaveBeenCalled()
  })

  it('401 invalid_grant when onboarding cannot mint (e.g. revoked grant)', async () => {
    verifyIdJagAssertion.mockReturnValue({ iss: 'iss', sub: 'sub' })
    registerAgentViaIdJag.mockResolvedValue(null)
    const res = await agentAuthPOST(authRequest({ grant_type: GRANT_TYPE, assertion: 'valid.assertion.sig' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('invalid_grant')
  })

  it('200 returns a Bearer token on a valid assertion', async () => {
    verifyIdJagAssertion.mockReturnValue({ iss: 'https://idp.example.com', sub: 'sub-1' })
    registerAgentViaIdJag.mockResolvedValue({
      principal: { id: 'p1', tenantId: TENANT, organizationId: ORG },
      grant: { id: 'g1' },
      token: { accessToken: 'minted.jwt.token', expiresInSeconds: 300, scope: 'deals:read', grantId: 'g1' },
    })
    const res = await agentAuthPOST(authRequest({ grant_type: GRANT_TYPE, assertion: 'valid.assertion.sig', scope: 'deals:read' }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.access_token).toBe('minted.jwt.token')
    expect(json.token_type).toBe('Bearer')
    expect(json.expires_in).toBe(300)
    expect(json.scope).toBe('deals:read')
    expect(registerAgentViaIdJag).toHaveBeenCalledWith(expect.anything(), { iss: 'https://idp.example.com', sub: 'sub-1' }, 'deals:read')
  })
})
